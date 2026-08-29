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

mod updates;

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// The file name a download URL is asking for.
///
/// The engine names its exports `<host>-<date>.<ext>` and serves them with a
/// `content-disposition`, but a download handler is given the URL and not the
/// headers, so the name is taken from the path. A URL that names nothing gets a
/// plain fallback rather than an empty save dialog.
fn download_name(url: &str) -> String {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    // Past `scheme://authority` before looking for the last segment. Without
    // this a URL carrying no path at all hands back the host, and the save
    // dialog opens named `127.0.0.1:4321`.
    let path = match without_query.find("://") {
        Some(at) => {
            let rest = &without_query[at + 3..];
            match rest.find('/') {
                Some(slash) => &rest[slash..],
                None => "",
            }
        }
        None => without_query,
    };
    let last = path.rsplit('/').next().unwrap_or("");
    let cleaned = last.trim();
    if cleaned.is_empty() {
        "seo-audit-report".to_string()
    } else {
        // Percent-decoding only what a generated filename can actually contain.
        cleaned.replace("%20", " ")
    }
}

/// A JS string literal, safe to paste into an `eval`.
///
/// Windows paths are full of backslashes and a report title can contain
/// anything the audited site put in its `<title>`, so neither may be dropped
/// into a script unescaped. Single quotes, because the toast call below uses
/// them.
fn as_js_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '<' => out.push_str("\\x3c"),
            _ => out.push(ch),
        }
    }
    out.push('\'');
    out
}

/// Ask where a finished download should live, put it there, and say so.
///
/// On its own thread, for the reason written at the call site: the download
/// handler runs on the main thread and a blocking dialog there freezes the
/// window. Everything below — the dialog, the move, the toast — happens after
/// the bytes have already arrived somewhere temporary.
///
/// Cancelling deletes the temporary file. A "Save as" that quietly leaves a
/// copy in the temp directory after being cancelled is the same class of
/// surprise as the one this whole function exists to fix.
fn keep_the_download(app: &tauri::AppHandle, landed: std::path::PathBuf) {
    use tauri_plugin_dialog::DialogExt;

    let app = app.clone();
    std::thread::spawn(move || {
        let name = landed
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "seo-audit-report".to_string());

        let chosen = app
            .dialog()
            .file()
            .set_file_name(&name)
            .blocking_save_file();

        let Some(chosen) = chosen else {
            let _ = std::fs::remove_file(&landed);
            return;
        };
        let Ok(target) = chosen.into_path() else {
            let _ = std::fs::remove_file(&landed);
            note("a save dialog returned somewhere that is not a path");
            return;
        };

        // Rename first: it is atomic and instant when both sides are on one
        // volume. The temp directory often is not, and rename across volumes
        // fails, so a copy is the fallback rather than the default.
        let moved = std::fs::rename(&landed, &target).or_else(|_| {
            std::fs::copy(&landed, &target).map(|_| {
                let _ = std::fs::remove_file(&landed);
            })
        });

        match moved {
            Ok(()) => announce_saved(&app, &target),
            Err(why) => {
                note(&format!("could not put the download where it was asked to go: {why}"));
                app.dialog()
                    .message(format!("The file could not be saved there.\n\n{why}"))
                    .title("Not saved")
                    .blocking_show();
            }
        }
    });
}

/// Tell the window a file was saved, in the page's own words.
///
/// The toast lives in the served HTML rather than here, so it is the same one
/// on every platform that shows it, and so this file draws no interface — the
/// rule the rest of the shell already follows. A shell that cannot reach the
/// toast says nothing rather than falling back to a modal: the save worked, and
/// a dialog demanding to be dismissed after every export is worse than silence.
fn announce_saved(app: &tauri::AppHandle, target: &std::path::Path) {
    let Some(window) = app.get_webview_window("main") else { return };
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let folder = target
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let _ = window.eval(format!(
        "window.seoAuditSaved && window.seoAuditSaved({}, {})",
        as_js_string(&name),
        as_js_string(&folder),
    ));
}

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

/// Make the operating system kill the engine when this process dies.
///
/// Everything else here is cooperative: closing the window fires `Destroyed`,
/// quitting fires `Exit`, and both stop the child. Nothing fires when a process
/// is terminated outright — Task Manager, a crash, `Stop-Process -Force` — and
/// on Windows the engine then survived, holding its port and 110 MB until
/// somebody noticed. CI found it by killing the app the hard way.
///
/// A job object with `KILL_ON_JOB_CLOSE` moves the promise from this code to
/// the kernel: when the last handle to the job closes, which happens when this
/// process ends however it ends, everything in the job goes with it.
///
/// The handle is deliberately never closed. Closing it is the thing that kills
/// the child, so it has to outlive everything except the process itself.
#[cfg(windows)]
fn tie_to_our_lifetime(child: &Child) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            note("could not create a job object; the engine is only stopped cooperatively");
            return;
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&limits) as u32,
        );
        let assigned = AssignProcessToJobObject(job, child.as_raw_handle() as _);
        note(&format!("job object: set={set} assigned={assigned}"));
    }
}

#[cfg(not(windows))]
fn tie_to_our_lifetime(_child: &Child) {
    // The engine already exits when its stdin closes, and a dying parent closes
    // it. That is the same guarantee, arrived at by a route Windows does not
    // offer — its pipe does not read as one to Node.
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

    tie_to_our_lifetime(&child);

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
                    &MenuItem::with_id(app, "update", "Check for Updates…", true, None::<&str>)?,
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

/// Look for a newer version, and offer the one thing that is safe.
///
/// Off the main thread and after the window is up: an update is never worth
/// delaying a report for. `forced` is the menu item, which asks regardless of
/// when it last looked.
fn look_for_updates(app: &tauri::AppHandle, node: std::path::PathBuf, forced: bool) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let app = app.clone();
    std::thread::spawn(move || {
        let stamp = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| std::env::temp_dir())
            .join("last-update-check");
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        if !forced && !updates::due(&stamp, now) {
            return;
        }

        let (tag, confirmed) = match updates::fetch_releases(&node) {
            updates::Answer::Api(body) => (updates::newest_tag(&body), true),
            // The API's anonymous quota is sixty an hour per address, shared
            // with every other tool on the machine, so being refused is
            // ordinary. The feed answers without one — it just cannot say
            // which entries are prereleases.
            updates::Answer::Feed(body) => (updates::newest_feed_tag(&body), false),
            updates::Answer::Silence(why) => {
                note(&format!("update check: no answer — {why}"));
                if forced {
                    app.dialog()
                        .message(format!("GitHub said nothing about new versions.\n\n{why}"))
                        .title("No answer")
                        .kind(MessageDialogKind::Warning)
                        .blocking_show();
                }
                return;
            }
        };
        updates::mark_checked(&stamp, now);

        let Some(tag) = tag else { return };
        let newest = updates::Version::parse(&tag);
        let mine = updates::Version::parse(env!("CARGO_PKG_VERSION"));
        note(&format!(
            "update check: newest {tag} ({}), this is {}",
            if confirmed { "confirmed" } else { "from the feed" },
            env!("CARGO_PKG_VERSION"),
        ));

        if !newest.is_newer_than(&mine) {
            if forced {
                app.dialog()
                    .message(format!("Version {} is the newest there is.", env!("CARGO_PKG_VERSION")))
                    .title("Up to date")
                    .blocking_show();
            }
            return;
        }

        let kind = updates::install_kind();
        let version = tag.trim_start_matches('v').to_string();
        let go = app
            .dialog()
            .message(updates::describe_answer(kind, &version, confirmed))
            .title("A new version")
            .buttons(MessageDialogButtons::OkCancelCustom(
                match updates::move_for(kind) {
                    updates::Move::Run { .. } => "Update".into(),
                    updates::Move::Tell { .. } => "Show me".into(),
                    updates::Move::Open => "Download".into(),
                },
                "Not now".into(),
            ))
            .blocking_show();
        if !go {
            return;
        }

        match updates::move_for(kind) {
            updates::Move::Run { command, args } => {
                let ran = Updates::stream(&command, &args);
                match ran {
                    Ok(()) => {
                        if app
                            .dialog()
                            .message("Installed. The app has to restart to be the new version.")
                            .title("Updated")
                            .buttons(MessageDialogButtons::OkCancelCustom("Relaunch".into(), "Later".into()))
                            .blocking_show()
                        {
                            app.restart();
                        }
                    }
                    Err(why) => {
                        app.dialog()
                            .message(format!("The update did not run.\n\n{why}"))
                            .title("Not updated")
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                    }
                }
            }
            updates::Move::Tell { command } => {
                app.dialog()
                    .message(format!(
                        "Run this in a terminal:\n\n{command}\n\nIt needs a password, which is why \
                         it is not run here."
                    ))
                    .title("Your package manager owns this copy")
                    .blocking_show();
            }
            updates::Move::Open => {
                let _ = app.opener().open_url(
                    "https://github.com/nurkamol/seo-audit/releases/latest",
                    None::<&str>,
                );
            }
        }
    });
}

/// A named holder for the one command an update ever runs.
struct Updates;

impl Updates {
    /// Run it and wait. The output is not streamed anywhere because a native
    /// dialog has nowhere to stream it to — what matters is whether it worked,
    /// and if it did not, what it said.
    fn stream(command: &str, args: &[String]) -> Result<(), String> {
        let mut task = Command::new(command);
        task.args(args);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            task.creation_flags(0x0800_0000);
        }

        let out = task.output().map_err(|e| format!("Could not start {command}: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        let said = String::from_utf8_lossy(&out.stderr);
        // Collected first: a filtered iterator has no known length, so it
        // cannot be reversed twice to take the last few.
        let lines: Vec<&str> = said.lines().filter(|line| !line.trim().is_empty()).collect();
        let tail: Vec<&str> = lines.iter().rev().take(4).rev().copied().collect();
        Err(if tail.is_empty() {
            format!("{command} exited {}.", out.status)
        } else {
            tail.join("\n")
        })
    }
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
        .plugin(tauri_plugin_dialog::init())
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
                    // The same Node the engine runs on, borrowed for one HTTPS
                    // request a day. After the window, never before it.
                    if let Ok((command, _)) = engine_command(&handle) {
                        look_for_updates(&handle, command.get_program().into(), false);
                    }
                    let home = url.clone();
                    let opener = handle.clone();
                    let for_new_windows = handle.clone();
                    let for_downloads = handle.clone();
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
                    // "Open link in new window" in the webview's own context
                    // menu did nothing at all: a new-window request is not a
                    // navigation, so the handler above never saw it, and
                    // nothing else was listening. Reported by somebody using
                    // the Windows build.
                    //
                    // A second window of our own would be a report with no
                    // sidebar and no way back, so this does what following an
                    // external link already does — hands it to the browser,
                    // which has an address bar.
                    .on_new_window(move |target, _features| {
                        let _ = for_new_windows
                            .opener()
                            .open_url(target.to_string(), None::<&str>);
                        NewWindowResponse::Deny
                    })
                    // Save as … was writing straight to Downloads with no
                    // dialog, and saying nothing afterwards. Also reported from
                    // the Windows build.
                    //
                    // The file lands in a temporary directory first and the
                    // person is asked where to put it once it has arrived. The
                    // obvious version — a save dialog inside `Requested`, so
                    // the destination is chosen before the bytes move — cannot
                    // be written: this handler runs on the main thread, and the
                    // dialog plugin says in as many words that a blocking
                    // dialog there freezes the application.
                    .on_download(move |_webview, event| match event {
                        DownloadEvent::Requested { url, destination } => {
                            let name = download_name(url.as_str());
                            *destination = std::env::temp_dir().join(&name);
                            true
                        }
                        DownloadEvent::Finished { path, success, .. } => {
                            if success {
                                if let Some(landed) = path {
                                    keep_the_download(&for_downloads, landed);
                                }
                            }
                            true
                        }
                        _ => true,
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
            if id == "update" {
                if let Ok((command, _)) = engine_command(app) {
                    look_for_updates(app, command.get_program().into(), true);
                }
                return;
            }
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

    #[test]
    fn a_download_url_names_the_file_it_wants() {
        // The handler is given a URL and not the response headers, so the name
        // comes off the path. `?as=` is a query and never part of it.
        assert_eq!(download_name("http://127.0.0.1:4321/x/site-2026-08-29.html"),
                   "site-2026-08-29.html");
        assert_eq!(download_name("http://127.0.0.1:4321/a/b.csv?as=csv#top"), "b.csv");
        assert_eq!(download_name("http://127.0.0.1:4321/a/my%20report.md"), "my report.md");
        // Never empty: an empty save dialog is worse than a dull name.
        assert_eq!(download_name("http://127.0.0.1:4321/"), "seo-audit-report");
        assert_eq!(download_name("http://127.0.0.1:4321"), "seo-audit-report");
    }

    #[test]
    fn a_saved_name_cannot_carry_script_into_the_toast() {
        // The file name comes from a report title, which came from somebody
        // else's <title>. It reaches the page through eval, so it is a string
        // literal and nothing else.
        assert_eq!(as_js_string("plain.csv"), "'plain.csv'");
        assert_eq!(as_js_string(r"C:\Users\a\b.csv"), r"'C:\\Users\\a\\b.csv'");
        assert_eq!(as_js_string("it's.csv"), r"'it\'s.csv'");
        // A closing tag would end the surrounding <script> whatever the quoting
        // says, so the angle bracket is escaped rather than the tag matched.
        assert!(!as_js_string("</script><img onerror=x>").contains('<'));
        assert!(!as_js_string("a\nb").contains('\n'));
    }
    use super::{
        announced_url, as_js_string, disagrees, download_name, help_link, is_the_app,
        without_verbatim_prefix,
    };
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
