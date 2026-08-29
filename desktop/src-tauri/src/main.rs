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

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

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

/// Where the report lives, and the only place this window is allowed to go.
///
/// A report is full of the audited site's own URLs, and clicking one used to
/// navigate the window away from the report and into somebody else's website —
/// with no address bar and no back button to get out of. Worse, that website
/// would then be running inside a window holding this app's capabilities.
///
/// So: the engine's own origin is the app, and everything else is a link that
/// belongs in a browser.
fn is_the_app(engine: &str, target: &tauri::Url) -> bool {
    tauri::Url::parse(engine)
        .map(|home| {
            target.scheme() == home.scheme()
                && target.host_str() == home.host_str()
                && target.port_or_known_default() == home.port_or_known_default()
        })
        .unwrap_or(false)
}

/// The menu, which is only ever navigation.
///
/// Every item here goes somewhere the served UI already is. That is the rule
/// this shell lives by: a menu item that did something the web UI cannot would
/// be a feature Windows has and macOS does not.
///
/// Edit and Window are the predefined ones rather than hand-written, because on
/// Linux and Windows a webview with no Edit menu is a text field where Ctrl-C
/// does nothing — which is not a thing anybody would think to test.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadata {
        name: Some("SEO Audit".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        website: Some("https://github.com/nurkamol/seo-audit".into()),
        ..Default::default()
    };

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New Audit", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "reports", "Reports", true, Some("CmdOrCtrl+L"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "help:site", "SEO Audit Help", true, None::<&str>)?,
            &MenuItem::with_id(app, "help:checks", "What It Checks", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "help:repo", "Source on GitHub", true, None::<&str>)?,
            &MenuItem::with_id(app, "help:changelog", "Release Notes", true, None::<&str>)?,
            &MenuItem::with_id(app, "help:issues", "Report an Issue", true, None::<&str>)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "SEO Audit",
                true,
                &[
                    &PredefinedMenuItem::about(app, Some("About SEO Audit"), Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &file,
            &edit,
            &help,
        ],
    )
}

/// What a Help item points at. One table, so a link that moves moves once.
fn help_link(id: &str) -> Option<&'static str> {
    match id {
        "help:site" => Some("https://nurkamol.github.io/seo-audit/"),
        "help:checks" => Some("https://github.com/nurkamol/seo-audit#what-it-checks"),
        "help:repo" => Some("https://github.com/nurkamol/seo-audit"),
        "help:changelog" => Some("https://github.com/nurkamol/seo-audit/blob/main/CHANGELOG.md"),
        "help:issues" => Some("https://github.com/nurkamol/seo-audit/issues"),
        _ => None,
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            app.set_menu(build_menu(&handle)?)?;

            // The window is built here rather than declared in the config,
            // because until the engine answers there is no address to point it
            // at. A window that appears and then navigates flashes; one that
            // appears already looking at the report does not.
            match start_engine(&handle) {
                Ok((url, child)) => {
                    handle.state::<Engine>().0.lock().unwrap().replace(child);
                    let home = url.clone();
                    let opener = handle.clone();
                    WebviewWindowBuilder::new(
                        &handle,
                        "main",
                        WebviewUrl::External(url.parse().expect("the engine printed a URL")),
                    )
                    .title("SEO Audit")
                    .inner_size(1180.0, 840.0)
                    .min_inner_size(720.0, 520.0)
                    // A report is full of the audited site's own URLs. Following
                    // one in here would replace the report with somebody else's
                    // website, in a window with no address bar to leave by.
                    .on_navigation(move |target| {
                        if is_the_app(&home, target) {
                            return true;
                        }
                        let _ = opener.opener().open_url(target.to_string(), None::<&str>);
                        false
                    })
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
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(link) = help_link(id) {
                let _ = app.opener().open_url(link, None::<&str>);
                return;
            }
            // The rest is navigation, because the served UI is where every
            // control in this app lives.
            let Some(window) = app.get_webview_window("main") else { return };
            let Ok(here) = window.url() else { return };
            let path = match id {
                "new" => "/",
                "reports" => "/reports",
                _ => return,
            };
            if let Ok(target) = here.join(path) {
                let _ = window.navigate(target);
            }
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
    use super::{announced_url, help_link, is_the_app};

    fn url(text: &str) -> tauri::Url {
        text.parse().expect("a test URL")
    }

    // A report is full of the audited site's own URLs, and this is what decides
    // whether clicking one stays in the app. Getting it wrong in the generous
    // direction puts somebody else's website inside a window holding this app's
    // capabilities, with no address bar to leave by.
    #[test]
    fn only_the_engine_is_the_app() {
        let engine = "http://127.0.0.1:53017/";

        assert!(is_the_app(engine, &url("http://127.0.0.1:53017/")));
        assert!(is_the_app(engine, &url("http://127.0.0.1:53017/reports")));
        assert!(is_the_app(engine, &url("http://127.0.0.1:53017/run?url=https://x.test")));
    }

    #[test]
    fn everything_else_is_a_link_for_a_browser() {
        let engine = "http://127.0.0.1:53017/";

        // The audited site, which is the common case and the whole point.
        assert!(!is_the_app(engine, &url("https://example.com/about/")));
        // Another port on this machine is another program.
        assert!(!is_the_app(engine, &url("http://127.0.0.1:53018/")));
        // The same port over TLS is not the same server.
        assert!(!is_the_app(engine, &url("https://127.0.0.1:53017/")));
        // A host that merely looks local.
        assert!(!is_the_app(engine, &url("http://127.0.0.1.example.com/")));
        assert!(!is_the_app(engine, &url("http://localhost:53017/")));
        // And a scheme that is not the web at all.
        assert!(!is_the_app(engine, &url("file:///etc/passwd")));
    }

    #[test]
    fn a_menu_item_either_opens_a_link_or_navigates() {
        // Help items leave the app; everything else is a path in the served UI,
        // because the shell owns no controls of its own.
        assert!(help_link("help:repo").is_some());
        assert!(help_link("help:issues").is_some());
        assert_eq!(help_link("new"), None);
        assert_eq!(help_link("reports"), None);
        assert_eq!(help_link("something-else"), None);
    }

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
