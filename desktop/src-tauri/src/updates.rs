// Telling somebody a new version exists, and doing the one thing that is safe
// for the way they installed this one.
//
// The macOS app settled the principle: **the thing that installed it is the
// thing that replaces it.** Homebrew put it there, so Homebrew takes it away
// again, and the app just runs the command in its own window rather than
// explaining it. That generalises, but not evenly — the platforms differ in
// what they will let a program do without a password it has no way to ask for.
//
// So this does not pretend to a single "Update" button that always works. It
// works out how this copy got here, and offers the one action that is actually
// correct for it. Where that action is a command, it runs it. Where it is not,
// it says so and opens the right page, which is a smaller promise honestly kept
// rather than a larger one broken on somebody's machine.
//
// What it deliberately does not do: download a binary and put it in place
// itself. That needs either a signature to check or a checksum to compare, and
// an updater that replaces an application on the strength of a plain HTTPS
// response is a supply-chain hole with a progress bar on it.

use std::path::Path;
use std::process::Command;

/// A version, as far as ordering releases needs.
///
/// Its own type rather than a crate: this compares three numbers, and the
/// alternative was a dependency for `<`.
#[derive(Debug, PartialEq, Eq, PartialOrd, Ord, Clone)]
pub struct Version(Vec<u32>);

impl Version {
    pub fn parse(text: &str) -> Version {
        Version(
            text.trim()
                .trim_start_matches(['v', 'V', ' '])
                .split('.')
                .map(|part| {
                    part.chars()
                        .take_while(char::is_ascii_digit)
                        .collect::<String>()
                        .parse()
                        .unwrap_or(0)
                })
                .collect(),
        )
    }

    /// Padded, so 1.34 and 1.34.0 are the same version rather than an upgrade.
    pub fn is_newer_than(&self, other: &Version) -> bool {
        let width = self.0.len().max(other.0.len());
        let at = |v: &Version, i: usize| v.0.get(i).copied().unwrap_or(0);
        for i in 0..width {
            match at(self, i).cmp(&at(other, i)) {
                std::cmp::Ordering::Equal => continue,
                order => return order == std::cmp::Ordering::Greater,
            }
        }
        false
    }
}

/// The identifier the winget manifest publishes under.
///
/// One constant because three things have to agree about it: the query that
/// asks whether winget installed this copy, the command that asks winget to
/// replace it, and the workflow that submits the manifest. A test in
/// `test/options.test.mjs` reads this line and the workflow and fails when they
/// drift, because winget answers a name it has never heard of with silence.
pub const WINGET_ID: &str = "Nurkamol.SeoAudit";

/// Whether `winget list` found this package.
///
/// The Id column is the reliable answer: `Name` is "SEO Audit" and the binary
/// is `seo-audit.exe`, so the previous test — does the output contain
/// "seo-audit" — was false for every real winget install. It would have stayed
/// false after the manifest shipped, and the winget branch would have gone on
/// being unreachable for a reason nobody was looking at any more.
///
/// Case-insensitive because winget is, about identifiers.
pub fn winget_knows_it(output: &str) -> bool {
    output.to_lowercase().contains(&WINGET_ID.to_lowercase())
}

/// How this copy got onto this machine.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Install {
    // Three of these are built only under a `#[cfg]` in `install_kind` — two on
    // Windows, one on Linux — so every build warned that some variant is never
    // constructed, while every platform still matches on all of them in
    // `move_for` and `describe`, because matching is not constructing.
    //
    // Silenced only where the claim is true. On Windows no `allow` applies, so
    // a variant that stops being reachable there — the case that would actually
    // matter — still warns. Narrower than an `allow` on the enum, which would
    // have hidden that too.
    /// Windows, and winget has a record of it.
    #[cfg_attr(not(windows), allow(dead_code))]
    Winget,
    /// Linux, and dpkg owns the file.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Apt,
    /// Linux, running from a single self-contained file.
    AppImage,
    /// Windows, installed by the bundled NSIS installer rather than winget.
    #[cfg_attr(not(windows), allow(dead_code))]
    Installer,
    /// Somebody put it here.
    Elsewhere,
}

/// What can honestly be offered for a given install.
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Move {
    /// Run this, here, and show what it says. The command replaces the app.
    Run { command: String, args: Vec<String> },
    /// Nothing here can replace it safely. Open the page that can.
    Open,
}

/// The one correct action for how this copy was installed.
///
/// `winget upgrade` is the only self-update here, and only because a per-user
/// install needs no elevation — the same property that makes the Homebrew path
/// work on macOS. `apt` needs root, and a GUI app that shells out to `sudo` is
/// a GUI app that hangs on a password prompt nobody can see.
///
/// AppImage and a hand-placed copy could in principle be replaced in place, and
/// deliberately are not: doing it safely needs a signature to check, and an
/// updater that overwrites an application on the strength of a plain HTTPS
/// response is a supply-chain hole with a progress bar on it.
pub fn move_for(install: Install) -> Move {
    match install {
        Install::Winget => Move::Run {
            command: "winget".into(),
            args: vec![
                "upgrade".into(),
                "--id".into(),
                WINGET_ID.into(),
                "--silent".into(),
                "--accept-source-agreements".into(),
                "--accept-package-agreements".into(),
            ],
        },
        // A .deb from this project's releases is installed by hand, and there is
        // no apt repository anywhere that carries it. `apt-get install
        // --only-upgrade seo-audit` therefore asks a source that has never
        // heard of the package and answers that it cannot locate it — an
        // instruction that reads like an answer and is not one, which is the
        // same failure the macOS updater had against a stale Homebrew tap.
        //
        // dpkg still owns the file, so this must not replace the binary in
        // place; the release page is where the next .deb actually is.
        Install::Apt
        | Install::AppImage
        | Install::Installer
        | Install::Elsewhere => Move::Open,
    }
}

/// One sentence about what happens next, for the dialog that offers it.
///
/// `confirmed` is false when only the Atom feed answered, which cannot tell a
/// prerelease from a release. Saying nothing at all in that case is what the
/// macOS app used to do, and no banner reads exactly like "you are up to date".
pub fn describe_answer(install: Install, version: &str, confirmed: bool) -> String {
    let body = describe(install, version);
    if confirmed {
        body
    } else {
        format!(
            "{body}\n\nGitHub's API was out of quota, so whether {version} is a full release could \
             not be checked."
        )
    }
}

pub fn describe(install: Install, version: &str) -> String {
    match install {
        Install::Winget => format!(
            "Version {version} is available.\n\nwinget installed this copy, so winget replaces it. \
             It runs here, and the app restarts when it is done."
        ),
        Install::Apt => format!(
            "Version {version} is available.\n\nYour package manager owns this copy, and updating it \
             needs a password this app cannot ask for. The command is on the next screen."
        ),
        Install::AppImage => format!(
            "Version {version} is available.\n\nThis is an AppImage — one file, wherever you put it. \
             Download the new one and replace it; nothing here overwrites an application on your \
             behalf."
        ),
        // "Close this app first" is not politeness. The installer offers to
        // remove the old version before writing the new one, and an uninstaller
        // cannot delete files that are open — it reports "Unable to uninstall!"
        // and stops. Reported by somebody updating 1.38.0 on Windows, who had
        // pressed Download in this very dialog and so still had the app running
        // when the installer ran.
        Install::Installer => format!(
            "Version {version} is available.\n\nClose this app before running the installer: it \
             cannot replace files that are still open. After that, running the new installer over \
             this one is the whole update. Nothing here downloads and runs an installer on your \
             behalf."
        ),
        Install::Elsewhere => format!(
            "Version {version} is available.\n\nThis copy was placed by hand, so replacing it is a \
             decision rather than something to do quietly."
        ),
    }
}

/// Where this copy came from.
///
/// Asked of the machine rather than assumed: the same binary is shipped three
/// ways on two platforms, and which one it is decides what can be offered.
pub fn install_kind() -> Install {
    // AppImage's own runtime sets this to the path of the file being run, and
    // nothing else does.
    if std::env::var_os("APPIMAGE").is_some() {
        return Install::AppImage;
    }

    let exe = std::env::current_exe().unwrap_or_default();

    #[cfg(target_os = "linux")]
    {
        // dpkg answers "which package owns this file" and fails when none does.
        let owned = Command::new("dpkg")
            .arg("-S")
            .arg(&exe)
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);
        if owned {
            return Install::Apt;
        }
    }

    #[cfg(windows)]
    {
        let known = Command::new("winget")
            .args(["list", "--id", WINGET_ID, "--exact"])
            .output()
            .map(|out| winget_knows_it(&String::from_utf8_lossy(&out.stdout)))
            .unwrap_or(false);
        if known {
            return Install::Winget;
        }
        // The bundled installer puts it under Local\SEO Audit; a copy anywhere
        // else was put there by somebody.
        if exe.to_string_lossy().contains("SEO Audit") {
            return Install::Installer;
        }
    }

    let _ = &exe;
    Install::Elsewhere
}

/// The newest full release's version, from GitHub's own listing.
///
/// The tag, and nothing else: this decides whether to say anything at all, and
/// every route from there is a command or a link that is already known. Parsed
/// by hand because pulling in a JSON crate to read one field is a dependency
/// for a `find`.
pub fn newest_tag(body: &str) -> Option<String> {
    // Releases come newest first. The first entry that is not a prerelease and
    // not a draft is the one to compare against — the same rule the macOS app
    // applies, and for the same reason: a feed that cannot tell them apart must
    // not be allowed to announce one.
    for entry in body.split("\"tag_name\":").skip(1) {
        let tag = entry
            .trim_start()
            .strip_prefix('"')?
            .split('"')
            .next()?
            .to_string();
        // The flags belong to this entry, so only look as far as the next one.
        let rest = entry.split("\"tag_name\":").next().unwrap_or(entry);
        let flagged = |name: &str| rest.contains(&format!("\"{name}\":true"));
        if !flagged("prerelease") && !flagged("draft") {
            return Some(tag);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winget_is_recognised_by_its_identifier_not_by_a_file_name() {
        // Real `winget list --id Nurkamol.SeoAudit --exact` output. The Name is
        // "SEO Audit" and the executable is seo-audit.exe, so the old test —
        // does this contain "seo-audit" — was false for every winget install
        // there could ever be, and would have stayed false after the manifest
        // shipped.
        let listed = "\
Name        Id                  Version   Available   Source
-------------------------------------------------------------
SEO Audit   Nurkamol.SeoAudit   1.38.0    1.39.0      winget
";
        assert!(winget_knows_it(listed));
        assert!(!listed.contains("seo-audit"), "which is what used to be looked for");

        // winget is not case-sensitive about identifiers, so neither is this.
        assert!(winget_knows_it("nurkamol.seoaudit"));

        // And what it says when it installed nothing of the sort.
        assert!(!winget_knows_it("No installed package found matching input criteria."));
        assert!(!winget_knows_it(""));
    }

    #[test]
    fn versions_order_the_way_releases_do() {
        let v = Version::parse;
        assert!(v("1.35.0").is_newer_than(&v("1.34.0")));
        assert!(v("v1.34.1").is_newer_than(&v("1.34.0")));
        assert!(v("2.0.0").is_newer_than(&v("1.99.99")));
        assert!(!v("1.34.0").is_newer_than(&v("1.34.0")));
        assert!(!v("1.34.0").is_newer_than(&v("1.35.0")));
        // Padded, so a shorter tag is not an upgrade over its own equal.
        assert!(!v("1.34").is_newer_than(&v("1.34.0")));
        assert!(!v("1.34.0").is_newer_than(&v("1.34")));
        // 10 is after 9, which string comparison gets wrong.
        assert!(v("1.10.0").is_newer_than(&v("1.9.0")));
    }

    #[test]
    fn the_newest_release_is_the_first_that_is_really_one() {
        // A prerelease at the top must not be announced: the whole point of
        // asking the API rather than the feed is that it says which is which.
        let body = r#"[
          {"tag_name":"v2.0.0-beta.1","draft":false,"prerelease":true},
          {"tag_name":"v1.35.0","draft":false,"prerelease":false},
          {"tag_name":"v1.34.0","draft":false,"prerelease":false}
        ]"#;
        assert_eq!(newest_tag(body).as_deref(), Some("v1.35.0"));

        // A draft is somebody's unpublished work.
        let drafted = r#"[{"tag_name":"v9.9.9","draft":true,"prerelease":false},
                          {"tag_name":"v1.35.0","draft":false,"prerelease":false}]"#;
        assert_eq!(newest_tag(drafted).as_deref(), Some("v1.35.0"));

        assert_eq!(newest_tag("[]"), None);
        assert_eq!(newest_tag("not json at all"), None);
    }

    // The half that matters: what each install is actually offered. A button
    // that runs the wrong command is worse than a button that opens a page.
    #[test]
    fn each_install_is_offered_only_what_is_safe_for_it() {
        // The one self-update, and only because a per-user winget install needs
        // no elevation — the same property that makes Homebrew work on macOS.
        match move_for(Install::Winget) {
            Move::Run { command, args } => {
                assert_eq!(command, "winget");
                assert!(args.contains(&"upgrade".to_string()));
                // The identifier the workflow publishes under. A test in
                // test/options.test.mjs asserts these two agree; naming a
                // package winget has never heard of finds nothing and says
                // nothing, which is the quietest possible failure.
                assert!(args.contains(&WINGET_ID.to_string()));
                assert!(args.contains(&"--silent".to_string()));
            }
            other => panic!("winget should run its own upgrade, got {other:?}"),
        }

        // apt needs root, and a GUI app that shells out to sudo hangs on a
        // password prompt nobody can see — and, since no apt repository carries
        // this package, no command it could be given would find a newer one.
        // Verified against the repository rather than guessed: nothing here
        // publishes a repo, a PPA or a sources.list entry.
        for kind in [Install::Apt, Install::AppImage, Install::Installer, Install::Elsewhere] {
            assert_eq!(move_for(kind), Move::Open, "{kind:?} must not self-replace");
        }
    }

    #[test]
    fn the_feed_answers_when_the_api_will_not() {
        // The real shape, from github.com/nurkamol/seo-audit/releases.atom.
        let feed = r#"<feed>
          <id>tag:github.com,2008:https://github.com/nurkamol/seo-audit/releases</id>
          <entry><id>tag:github.com,2008:Repository/1327685872/v1.34.0</id></entry>
          <entry><id>tag:github.com,2008:Repository/1327685872/v1.33.1</id></entry>
        </feed>"#;
        // The feed's own id comes first and is not a release; the rule reads
        // the entry ids, which are the only place a tag appears unmixed with a
        // title somebody wrote.
        assert_eq!(newest_feed_tag(feed).as_deref(), Some("v1.34.0"));
        assert_eq!(newest_feed_tag("<feed></feed>"), None);
    }

    #[test]
    fn an_unconfirmed_version_says_so() {
        let sure = describe_answer(Install::Winget, "1.35.0", true);
        let not = describe_answer(Install::Winget, "1.35.0", false);
        assert!(!sure.contains("out of quota"));
        assert!(not.contains("out of quota"));
        assert!(not.contains("1.35.0"));
        // The action is the same either way; only the claim about it changes.
        assert!(not.starts_with(&sure));
    }

    #[test]
    fn asking_again_waits_a_day() {
        let dir = std::env::temp_dir().join(format!("seo-audit-stamp-{}", std::process::id()));
        let stamp = dir.join("checked");

        // Never asked before.
        assert!(due(&stamp, 1_000_000));

        mark_checked(&stamp, 1_000_000);
        assert!(!due(&stamp, 1_000_000), "just asked");
        assert!(!due(&stamp, 1_086_399), "not quite a day");
        assert!(due(&stamp, 1_086_400), "a day");

        // A stamp somebody edited, or a half-written file, asks again rather
        // than never asking again.
        std::fs::write(&stamp, "tomorrow").unwrap();
        assert!(due(&stamp, 1_000_000));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_install_gets_a_sentence_that_says_what_happens() {
        for kind in [
            Install::Winget,
            Install::Apt,
            Install::AppImage,
            Install::Installer,
            Install::Elsewhere,
        ] {
            let said = describe(kind, "1.35.0");
            assert!(said.contains("1.35.0"), "{kind:?} should name the version");
            assert!(said.len() > 80, "{kind:?} should explain, not announce");
        }
    }

    #[test]
    fn the_installer_is_told_to_close_the_app_first() {
        // A Windows tester pressed Download in this dialog, kept the app open,
        // ran the installer, and got "Unable to uninstall!" — an uninstaller
        // cannot delete files that are still open. The dialog had told them
        // running the installer over the top was the whole update, which is
        // true only once this app is closed.
        let said = describe(Install::Installer, "1.38.1");
        assert!(said.contains("Close this app"), "it has to say so before they start");

        // Nothing else is asked to close anything: winget replaces a copy it
        // owns, and the rest only ever open a page.
        for kind in [Install::Winget, Install::Apt, Install::AppImage, Install::Elsewhere] {
            assert!(
                !describe(kind, "1.38.1").contains("Close this app"),
                "{kind:?} does not run an installer over itself",
            );
        }
    }
}

/// Where the answer came from, because it changes what may be claimed.
///
/// The API marks prereleases and the Atom feed does not, so a version learned
/// from the feed can be announced but not asserted to be a full release. The
/// macOS app reached this conclusion first; it is the same rule here because it
/// is the same GitHub.
#[derive(Debug, PartialEq, Eq)]
pub enum Answer {
    /// The API answered, and it says which releases are real.
    Api(String),
    /// The API refused — its anonymous quota is sixty an hour per address,
    /// shared with every other tool on the machine, so this is ordinary rather
    /// than exceptional. The feed answered instead.
    Feed(String),
    /// Neither said anything, and why.
    Silence(String),
}

/// The newest version in the Atom feed.
///
/// The tag is the last path segment of an entry's id — `Repository/1327/v1.34.0`
/// — which is the same place the macOS app reads it from, and the only place in
/// the feed it appears unmixed with a title somebody wrote.
pub fn newest_feed_tag(body: &str) -> Option<String> {
    body.split("<id>tag:github.com,2008:Repository/")
        .nth(1)?
        .split("</id>")
        .next()?
        .rsplit('/')
        .next()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
}

/// GitHub's release listing, fetched with the Node this app already ships.
///
/// No HTTP client crate. Adding one means a TLS stack and fifteen dependencies
/// so that a 110 MB bundle can make a single request a year — while the runtime
/// sitting next to the binary has `fetch` built in. Using what is already there
/// is not a shortcut here; it is the smaller thing.
///
/// The API rather than the Atom feed, because only the API marks a prerelease,
/// and announcing one as an update is the mistake the macOS app made a point of
/// not making.
pub fn fetch_releases(node: &Path) -> Answer {
    // The API first, then the feed. The feed needs no quota, which is the
    // whole reason it is worth asking — and the reason the answer says which
    // one replied.
    const SCRIPT: &str = r#"
      const api = 'https://api.github.com/repos/nurkamol/seo-audit/releases?per_page=20';
      const feed = 'https://github.com/nurkamol/seo-audit/releases.atom';
      const head = { 'user-agent': 'seo-audit-desktop' };
      fetch(api, { headers: { ...head, accept: 'application/vnd.github+json' } })
        .then((r) => (r.ok ? r.text().then((t) => 'api\n' + t) : Promise.reject(new Error('HTTP ' + r.status))))
        .catch((first) =>
          fetch(feed, { headers: head })
            .then((r) => (r.ok ? r.text().then((t) => 'feed\n' + t) : Promise.reject(new Error('HTTP ' + r.status))))
            .catch((second) => Promise.reject(new Error(first.message + '; then ' + second.message))))
        .then((t) => process.stdout.write(t))
        .catch((e) => { process.stderr.write(String(e.message)); process.exit(1); });
    "#;

    let mut command = Command::new(node);
    command.arg("-e").arg(SCRIPT);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let Ok(out) = command.output() else {
        return Answer::Silence("the runtime would not start".into());
    };
    if !out.status.success() {
        let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Answer::Silence(if said.is_empty() { "no answer".into() } else { said });
    }

    let body = String::from_utf8_lossy(&out.stdout).to_string();
    match body.split_once('\n') {
        Some(("api", rest)) => Answer::Api(rest.to_string()),
        Some(("feed", rest)) => Answer::Feed(rest.to_string()),
        _ => Answer::Silence("an answer in a shape this does not understand".into()),
    }
}

/// Whether enough time has passed to ask again.
///
/// A day, and the stamp is a file rather than a preference: this shell keeps no
/// settings, and one number does not justify starting.
pub fn due(stamp: &Path, now: u64) -> bool {
    const A_DAY: u64 = 86_400;
    match std::fs::read_to_string(stamp) {
        Ok(text) => text.trim().parse::<u64>().map(|then| now.saturating_sub(then) >= A_DAY).unwrap_or(true),
        Err(_) => true,
    }
}

pub fn mark_checked(stamp: &Path, now: u64) {
    if let Some(parent) = stamp.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(stamp, now.to_string());
}
