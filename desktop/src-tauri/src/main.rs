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
use std::path::PathBuf;
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

/// Somewhere for a windowed app to say what happened.
///
/// On Windows this is built with `windows_subsystem = "windows"`, which means
/// no console and no stdout: when it fails it can put a sentence in a window
/// and nothing else, which is fine for a person and useless for anything
/// automated — including the job that installs it and checks it runs.
///
/// So when `SEO_AUDIT_SHELL_LOG` names a file, the startup path narrates itself
/// into it. Off unless asked for, and it holds no secrets: paths, a version and
/// whatever the engine said about its own failure.
fn note(line: &str) {
    let Ok(path) = std::env::var("SEO_AUDIT_SHELL_LOG") else { return };
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

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

/// A path Node can actually read.
///
/// `resource_dir()` hands back a Windows *verbatim* path — the `\\?\` form that
/// lifts the 260-character limit. Rust is happy with it and Node is not: the
/// script runs, but `import.meta.url` comes out malformed, so anything
/// resolving a sibling file fails. `--version` reads `../package.json`, so it
/// answered nothing, and the shell refused to start an engine it had decided
/// was broken.
///
/// Found by installing the Windows build in CI and reading the log it writes,
/// which is the only reason any of this was visible.
fn without_verbatim_prefix(text: &str) -> &str {
    text.strip_prefix(r"\\?\").unwrap_or(text)
}

/// The same, for a path.
fn plain(path: PathBuf) -> PathBuf {
    match path.to_str() {
        Some(text) => PathBuf::from(without_verbatim_prefix(text)),
        None => path,
    }
}

/// Where the engine is, and what to run it with.
///
/// In a bundle these are beside the executable; in development they are the
/// repository itself, so `tauri dev` runs the working tree rather than a copy
/// of it. Packaging replaces the first arm and nothing else — that is phase 3.
fn engine_command(app: &tauri::AppHandle) -> Result<(Command, PathBuf), String> {
    // A bundled runtime. Tauri puts an `externalBin` beside the executable and
    // a `resources` entry in the platform's resource directory, which are two
    // different places — the runtime next to the binary, the JavaScript with
    // the icons.
    if let (Ok(exe), Ok(resources)) = (std::env::current_exe(), app.path().resource_dir()) {
        note(&format!("exe: {}", exe.display()));
        note(&format!("resources: {}", resources.display()));
        let node = exe
            .parent()
            .map(|beside| beside.join(if cfg!(windows) { "node.exe" } else { "node" }))
            .unwrap_or_default();
        let cli = plain(resources.join("engine/bin/seo-audit.mjs"));
        note(&format!("node: {} ({})", node.display(), if node.is_file() { "there" } else { "missing" }));
        note(&format!("cli: {} ({})", cli.display(), if cli.is_file() { "there" } else { "missing" }));
        if node.is_file() && cli.is_file() {
            let mut command = Command::new(&node);
            command.arg(&cli);
            return Ok((command, cli));
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
        // Canonicalising is what introduces the verbatim prefix on Windows, so
        // it comes straight back off again.
        let cli = plain(cli.canonicalize().map_err(|e| e.to_string())?);
        let mut command = Command::new(node);
        command.arg(&cli);
        // No version check in development: the checkout *is* the engine, and
        // whatever the working tree says is by definition what is meant.
        return Ok((command, PathBuf::new()));
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
/// What the engine beside this shell says its version is.
///
/// The reason this exists is narrow and specific. Tauri's NSIS installer has a
/// reported bug where a Windows upgrade replaces the main binary and leaves the
/// sidecar behind — and here the sidecar *is* the engine, so the app would come
/// back looking new and run the old checks, with nothing on screen to say so.
/// A missing finding reads exactly like a passing one, and a stale engine is a
/// whole report of them.
///
/// See https://github.com/tauri-apps/tauri/issues/15134
fn engine_version(command: &mut Command) -> Option<String> {
    let shown = command.arg("--version").output().ok()?;
    shown
        .status
        .success()
        .then(|| String::from_utf8_lossy(&shown.stdout).trim().to_string())
        .filter(|version| !version.is_empty())
}

/// Whether a bundled engine is the one this shell was built against.
///
/// Only asked of a bundle: in development the checkout is the engine, and
/// whatever the working tree says is by definition what was meant.
fn disagrees(bundled: &std::path::Path, found: Option<&str>) -> Option<String> {
    if bundled.as_os_str().is_empty() {
        return None;
    }
    let mine = env!("CARGO_PKG_VERSION");
    match found {
        Some(theirs) if theirs == mine => None,
        Some(theirs) => Some(format!(
            "This window is version {mine} and the engine inside it is {theirs}.\n\n\
             An update replaced one and not the other, so the checks that would run are \
             not the ones this version ships. Reinstalling puts them back together."
        )),
        None => Some(format!(
            "The engine inside this build would not say which version it is.\n\n\
             That usually means an update left a broken copy behind. Reinstalling \
             replaces it."
        )),
    }
}

fn start_engine(app: &tauri::AppHandle) -> Result<(String, Child), String> {
    let (mut command, bundled) = engine_command(app)?;

    // Asked before the crawl server starts, because a shell and an engine that
    // disagree is not a thing to find out about halfway through a report.
    if !bundled.as_os_str().is_empty() {
        let (mut probe, _) = engine_command(app)?;
        let found = engine_version(&mut probe);
        note(&format!("engine says version {found:?}, shell is {}", env!("CARGO_PKG_VERSION")));
        if let Some(why) = disagrees(&bundled, found.as_deref()) {
            note(&format!("refused: {why}"));
            return Err(why);
        }
    }

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

    // Read rather than merely piped. It was piped and never read, so when the
    // engine died on a missing module the window said "never said where it was
    // listening" — true, and useless, while the reason sat unread in a pipe.
    // The same failure this project refuses in its reports: an answer that does
    // not say what actually happened.
    let complaints = std::sync::Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let kept = complaints.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Ok(mut held) = kept.lock() {
                    held.push(line);
                    // Enough for a stack trace's first few frames, and bounded
                    // so a chatty engine cannot fill memory.
                    if held.len() > 40 {
                        held.remove(0);
                    }
                }
            }
        });
    }

    match rx.recv_timeout(ANNOUNCE_TIMEOUT) {
        Ok(url) => {
            note(&format!("serving at {url}"));
            Ok((url, child))
        }
        Err(_) => {
            let _ = child.kill();
            let said = complaints.lock().map(|held| held.clone()).unwrap_or_default();
            let why = refusal(&said);
            note(&format!("failed: {why}"));
            Err(why)
        }
    }
}

/// What to say when the engine started and then did not answer.
///
/// Its own words where it had any. "The engine started but never said where it
/// was listening" is a description of the symptom, and the cause was in the
/// pipe the whole time.
fn refusal(said: &[String]) -> String {
    let complaint: Vec<&String> = said.iter().filter(|line| !line.trim().is_empty()).collect();
    if complaint.is_empty() {
        return "The engine started but never said where it was listening, and said nothing \
                about why."
            .into();
    }
    let tail: Vec<&str> = complaint
        .iter()
        .rev()
        .take(6)
        .rev()
        .map(|line| line.as_str())
        .collect();
    format!(
        "The engine started but never said where it was listening. It said:\n\n{}",
        tail.join("\n")
    )
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
                    note(&format!("no window on a report: {why}"));
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
        .build(tauri::generate_context!())
        .expect("the window could not start")
        .run(|app, event| {
            // Closing the last window is one way this ends; being terminated is
            // another, and only the first fires `Destroyed`. CI killed the app
            // rather than clicking its close button and the engine carried on
            // holding its port — which is the same bug this project shipped
            // once on macOS, reached by a different door.
            if let tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } = event {
                app.state::<Engine>().stop();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{announced_url, disagrees, help_link, is_the_app, without_verbatim_prefix};
    use std::path::Path;

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

    // Tauri's NSIS installer has a reported bug where a Windows upgrade
    // replaces the main binary and leaves the sidecar behind — and here the
    // sidecar is the engine, so the app would come back looking new and run the
    // old checks with nothing on screen to say so.
    #[test]
    fn a_bundled_engine_of_the_wrong_version_is_refused() {
        let bundled = Path::new("/Applications/x.app/Contents/Resources/engine/bin/seo-audit.mjs");
        let mine = env!("CARGO_PKG_VERSION");

        // The ordinary case: they were installed together.
        assert!(disagrees(bundled, Some(mine)).is_none());

        // The bug: the shell moved and the engine did not.
        let stale = disagrees(bundled, Some("1.2.3")).expect("a mismatch is worth refusing");
        assert!(stale.contains("1.2.3"), "the message names the version that is there");
        assert!(stale.contains(mine), "and the one that should be");
        assert!(stale.contains("Reinstalling"), "and what to do about it");

        // A copy too broken to answer is the same class of problem.
        assert!(disagrees(bundled, None).is_some());
    }

    // Development is exempt: the checkout is the engine, and whatever the
    // working tree says is by definition what was meant.
    #[test]
    fn a_checkout_is_never_the_wrong_version() {
        assert!(disagrees(Path::new(""), Some("0.0.0-anything")).is_none());
        assert!(disagrees(Path::new(""), None).is_none());
    }

    // Windows hands back a verbatim path from `resource_dir()`. Rust is happy
    // with it and Node is not — the script runs, but `import.meta.url` comes
    // out malformed and anything resolving a sibling file fails. The installed
    // app answered nothing to `--version`, decided its own engine was broken,
    // and refused to start.
    #[test]
    fn a_verbatim_windows_path_is_made_readable() {
        assert_eq!(
            without_verbatim_prefix(r"\\?\C:\Users\a\AppData\Local\SEO Audit\engine\bin\seo-audit.mjs"),
            r"C:\Users\a\AppData\Local\SEO Audit\engine\bin\seo-audit.mjs",
        );
        // Everything else is left exactly as it is.
        assert_eq!(without_verbatim_prefix(r"C:\Users\a\app.exe"), r"C:\Users\a\app.exe");
        assert_eq!(without_verbatim_prefix("/usr/lib/seo-audit/engine"), "/usr/lib/seo-audit/engine");
        assert_eq!(without_verbatim_prefix(""), "");
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
