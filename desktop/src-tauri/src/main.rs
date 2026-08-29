// The window, on the platforms the macOS app does not ship to.
//
// It draws nothing. The engine is the same `bin/seo-audit.mjs` the terminal
// runs, started with `--serve 0`, and the report is the HTML that server
// already produces — sidebar, score ring and all. This file is the frame
// around it: start the child, find out where it landed, point the webview
// there, and take it down again on the way out.
//
// That is deliberately the whole job. Anything this were tempted to draw
// itself would be a control that exists on Windows and not on macOS, and the
// rule that keeps five front ends honest is that none of them re-implements
// anything.
//
// The logic below is a port of `mac/SeoAudit/Engine.swift`, including the parts
// that were only learned by getting them wrong there.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

/// How long to wait for the engine to say where it is listening.
///
/// The same fifteen seconds the macOS app allows. A cold start reading a
/// hundred-megabyte Node off a spinning disk is slow; a minute of a blank
/// window is not a thing anybody waits through.
const ANNOUNCE_TIMEOUT: Duration = Duration::from_secs(15);

/// The child, kept so it can be killed. A server that outlives the window that
/// opened it holds its port against the next launch — which is a bug this
/// project has already shipped once, on the other platform.
struct Engine(Mutex<Option<Child>>);

impl Engine {
    fn stop(&self) {
        if let Ok(mut held) = self.0.lock() {
            if let Some(mut child) = held.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// Where the engine is, and what to run it with.
///
/// In a bundle these are beside the executable; in development they are the
/// repository itself, so `tauri dev` runs the working tree rather than a copy
/// of it. Packaging replaces the first arm and nothing else — that is phase 3.
fn engine_command(app: &tauri::AppHandle) -> Result<Command, String> {
    // A bundled runtime, once there is one.
    if let Ok(resources) = app.path().resource_dir() {
        let node = resources.join(if cfg!(windows) { "engine/node.exe" } else { "engine/node" });
        let cli = resources.join("engine/bin/seo-audit.mjs");
        if node.is_file() && cli.is_file() {
            let mut command = Command::new(node);
            command.arg(cli);
            return Ok(command);
        }
    }

    // Development: this repository, and whatever Node is on the machine.
    let repo = std::env::current_dir()
        .map_err(|e| format!("Could not find the working directory: {e}"))?;
    // `tauri dev` runs from src-tauri, so the repository root is two up.
    let cli = repo.join("../../bin/seo-audit.mjs");
    if cli.is_file() {
        let node = which_node().ok_or_else(|| {
            "No Node on this machine, and this build has no engine inside it. \
             Install Node 18 or later — `brew install node`, or your package manager."
                .to_string()
        })?;
        let mut command = Command::new(node);
        command.arg(cli.canonicalize().map_err(|e| e.to_string())?);
        return Ok(command);
    }

    Err("This build has no engine to run, and there is no checkout beside it.".into())
}

/// Node, by path rather than by asking the shell.
///
/// A window launched from a dock or a Start menu inherits almost no `PATH`, so
/// looking it up the obvious way finds nothing on a machine that plainly has
/// it. The macOS app learned this about Homebrew and it is the same lesson.
fn which_node() -> Option<std::path::PathBuf> {
    let candidates: &[&str] = if cfg!(windows) {
        &[r"C:\Program Files\nodejs\node.exe"]
    } else {
        &["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
    };
    for path in candidates {
        let path = std::path::PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    // Then the environment, for a machine that manages its own versions —
    // nvm, asdf, fnm and the like all work by putting node on PATH.
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
            candidate.is_file().then_some(candidate)
        })
    })
}

/// Start the engine and wait for it to say where it is.
///
/// Port zero: the operating system picks one that is free and the server prints
/// where it landed. Guessing a port is how two copies of an app fight over one.
fn start_engine(app: &tauri::AppHandle) -> Result<(String, Child), String> {
    let mut command = engine_command(app)?;
    command
        .arg("--serve")
        .arg("0")
        // The server shuts down when its stdin closes, which is how it learns
        // that the window it belongs to has gone. Handing it a pipe is what
        // makes that work.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        // No console window flashing up behind the app.
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("The audit engine would not start: {e}"))?;

    let stdout = child.stdout.take().ok_or("The engine gave no output to read.")?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(url) = announced_url(&line) {
                let _ = tx.send(url);
                return;
            }
        }
    });

    match rx.recv_timeout(ANNOUNCE_TIMEOUT) {
        Ok(url) => Ok((url, child)),
        Err(_) => {
            let _ = child.kill();
            Err("The engine started but never said where it was listening.".into())
        }
    }
}

/// The address out of the line the server prints.
///
/// Matched on the words rather than on a position, because the banner around
/// them is prose and prose gets edited.
fn announced_url(line: &str) -> Option<String> {
    let after = line.split("serving at ").nth(1)?;
    let url = after.split_whitespace().next()?;
    url.starts_with("http://").then(|| url.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // The window is built here rather than declared in the config,
            // because until the engine answers there is no address to point it
            // at. A window that appears and then navigates flashes; one that
            // appears already looking at the report does not.
            match start_engine(&handle) {
                Ok((url, child)) => {
                    handle.state::<Engine>().0.lock().unwrap().replace(child);
                    WebviewWindowBuilder::new(
                        &handle,
                        "main",
                        WebviewUrl::External(url.parse().expect("the engine printed a URL")),
                    )
                    .title("SEO Audit")
                    .inner_size(1180.0, 840.0)
                    .min_inner_size(720.0, 520.0)
                    .build()?;
                }
                Err(why) => {
                    // Said in a window, not on a stream nobody is reading. An
                    // app that opens and does nothing is the worst version of
                    // this failure, and it is the one that shipped on macOS.
                    WebviewWindowBuilder::new(&handle, "main", WebviewUrl::App("index.html".into()))
                        .title("SEO Audit")
                        .inner_size(560.0, 340.0)
                        .build()?
                        .eval(format!(
                            "document.body.dataset.problem = {}",
                            serde_json::to_string(&why).unwrap_or_else(|_| "\"\"".into())
                        ))?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                window.app_handle().state::<Engine>().stop();
            }
        })
        .run(tauri::generate_context!())
        .expect("the window could not start");
}

#[cfg(test)]
mod tests {
    use super::announced_url;

    // The one piece of parsing in this file, and the whole handshake depends on
    // it: get this wrong and the window waits fifteen seconds and then says the
    // engine never spoke, on a machine where it did.
    #[test]
    fn reads_the_address_out_of_the_banner() {
        assert_eq!(
            announced_url("  seo-audit is serving at http://127.0.0.1:4321/"),
            Some("http://127.0.0.1:4321/".into()),
        );
        // The port is chosen by the operating system, so any of them.
        assert_eq!(
            announced_url("  seo-audit is serving at http://127.0.0.1:53017/"),
            Some("http://127.0.0.1:53017/".into()),
        );
    }

    #[test]
    fn ignores_every_other_line() {
        // The banner has two lines and only one is an address.
        assert_eq!(announced_url("  Nothing leaves this machine. Ctrl-C to stop."), None);
        assert_eq!(announced_url(""), None);
        assert_eq!(announced_url("crawl      200     41ms  /about/"), None);
    }

    // Matched on the words rather than a position, because the prose around
    // them gets edited — but never at the cost of accepting something that is
    // not an address this shell should navigate to.
    #[test]
    fn refuses_anything_that_is_not_a_local_http_url() {
        assert_eq!(announced_url("serving at "), None);
        assert_eq!(announced_url("serving at nowhere"), None);
        assert_eq!(announced_url("serving at ftp://127.0.0.1/"), None);
        assert_eq!(announced_url("serving at file:///etc/passwd"), None);
    }
}
