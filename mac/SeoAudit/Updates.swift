// Versions: what is out, what changed, and how to move between them.
//
// The app does not replace itself. Downloading a build and swapping it in is
// something a signed, notarised updater does safely and an unsigned one does
// dangerously, and there is no signing identity in this project. So this reads
// the releases, shows what changed, and hands the move to Homebrew — which
// verifies a checksum, or to the browser, where Gatekeeper still gets a say.
//
// Downgrading is the same mechanism in the other direction and is deliberately
// as easy: a release that makes a site's report worse should be undoable
// without reading a manual.

import Foundation
import AppKit

struct Release: Decodable, Identifiable, Hashable {
    let tagName: String
    let name: String?
    let body: String?
    let publishedAt: Date?
    let htmlUrl: String
    let prerelease: Bool
    /// The releases feed does not mark prereleases, so a list read from it
    /// cannot be trusted to answer "is there an update" — only to be shown.
    /// Defaulted rather than required so a cache written by an older build
    /// still decodes.
    var fromFeed: Bool = false

    var id: String { tagName }
    var version: Version { Version(tagName) }
    var title: String { name ?? tagName }

    /// The zip the release workflow attaches. Derived rather than read from the
    /// API's asset list, because the feed has no assets at all and a list that
    /// works for half the releases is worse than one rule that holds for every
    /// tag: `mac-release.yml` names it `seo-audit-<version>-macos.zip`, and the
    /// name is asserted in the workflow rather than chosen per release.
    var downloadUrl: URL? {
        let version = version.description
        return URL(string: "https://github.com/nurkamol/seo-audit/releases/download/"
                   + "\(tagName)/seo-audit-\(version)-macos.zip")
    }

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case name, body, prerelease, fromFeed
        case publishedAt = "published_at"
        case htmlUrl = "html_url"
    }
}

extension Release: Encodable {
    func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(tagName, forKey: .tagName)
        try box.encodeIfPresent(name, forKey: .name)
        try box.encodeIfPresent(body, forKey: .body)
        try box.encodeIfPresent(publishedAt, forKey: .publishedAt)
        try box.encode(htmlUrl, forKey: .htmlUrl)
        try box.encode(prerelease, forKey: .prerelease)
        try box.encode(fromFeed, forKey: .fromFeed)
    }
}

/// Enough of semver to order releases. Anything unparseable sorts oldest, which
/// is the safe direction: an odd tag never claims to be an upgrade.
struct Version: Comparable, CustomStringConvertible {
    let parts: [Int]

    init(_ text: String) {
        parts = text
            .trimmingCharacters(in: CharacterSet(charactersIn: "v "))
            .split(separator: ".")
            .map { Int($0.prefix(while: \.isNumber)) ?? 0 }
    }

    var description: String { parts.map(String.init).joined(separator: ".") }

    static func < (a: Version, b: Version) -> Bool {
        for i in 0..<max(a.parts.count, b.parts.count) {
            let left = i < a.parts.count ? a.parts[i] : 0
            let right = i < b.parts.count ? b.parts[i] : 0
            if left != right { return left < right }
        }
        return false
    }

    static func == (a: Version, b: Version) -> Bool { !(a < b) && !(b < a) }
}

@MainActor
final class Updates: ObservableObject {
    @Published private(set) var releases: [Release] = []
    @Published private(set) var checking = false
    @Published private(set) var problem: String?
    @Published var lastChecked: Date?
    @Published var downloadState: DownloadState = .idle
    /// Where an in-app Homebrew upgrade has got to.
    @Published var upgradeState: UpgradeState = .idle

    private let endpoint = URL(string: "https://api.github.com/repos/nurkamol/seo-audit/releases?per_page=30")!
    /// The same releases as an Atom feed, served by github.com rather than
    /// api.github.com — so it does not spend the sixty-an-hour anonymous API
    /// quota, which is per address and shared with every other tool on the
    /// machine that talks to GitHub.
    private let feed = URL(string: "https://github.com/nurkamol/seo-audit/releases.atom")!
    private let checkedKey = "seo-audit.updates.lastChecked"
    private let automaticKey = "seo-audit.updates.automatic"
    private let cache: URL
    private var ticker: Timer?
    private var woke: NSObjectProtocol?

    var current: Version {
        Version(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")
    }

    var newest: Release? {
        releases.filter { !$0.prerelease }.max { $0.version < $1.version }
    }

    var available: Release? {
        // A feed-sourced list cannot tell a prerelease from a release, so it is
        // never allowed to announce an update *as* one. Showing the list is
        // useful; pushing somebody onto a prerelease because the feed did not
        // say so is the same false positive this project refuses in its reports.
        Updates.announce(in: releases, current: current).confirmed
    }

    /// A newer version that the feed knows about and the API could not confirm.
    ///
    /// GitHub's anonymous quota is sixty an hour **per address**, shared with
    /// every other tool on the machine, so exhausting it is ordinary — and when
    /// it is exhausted this app fell back to the feed and then said nothing at
    /// all, because `available` refuses to announce a feed release. No banner
    /// reads exactly like "you are up to date", which is the failure this
    /// project spends its whole report format avoiding, applied to itself.
    ///
    /// So it is announced, and worded as what it is: something is newer, and
    /// whether it is a full release could not be checked. The person decides.
    var unconfirmed: Release? {
        Updates.announce(in: releases, current: current).unconfirmed
    }

    /// Which of the two a list amounts to, if either.
    ///
    /// A pure function so the rule can be tested without a window, a network or
    /// a bundle version — the same reason the Homebrew helpers below are.
    nonisolated static func announce(in releases: [Release], current: Version)
        -> (confirmed: Release?, unconfirmed: Release?) {
        guard let newest = releases.filter({ !$0.prerelease }).max(by: { $0.version < $1.version }),
              current < newest.version
        else { return (nil, nil) }
        return newest.fromFeed ? (nil, newest) : (newest, nil)
    }

    /// True when what is on screen came from the feed, and so is a list rather
    /// than an answer. The sheet says so instead of quietly showing less.
    var listIsPartial: Bool { !releases.isEmpty && releases.allSatisfy(\.fromFeed) }

    init(root: URL? = nil) {
        // The same folder the reports live in. These were briefly two: "SEO
        // Audit" here and "seo-audit" there, which is one app with two homes.
        cache = Support.directory(root).appendingPathComponent("releases.json")

        lastChecked = UserDefaults.standard.object(forKey: checkedKey) as? Date
        // A sheet that has ever succeeded should never open empty again. GitHub
        // answering 403 an hour later is not a reason to forget what it said.
        if let data = try? Data(contentsOf: cache) {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            releases = (try? decoder.decode([Release].self, from: data)) ?? []
        }
    }

    /// Whether to look at all. On by default, because an app that never
    /// mentions a new version is an app people run an old one of for years —
    /// and off is a real preference, because it is one request to GitHub about
    /// which software you run.
    var automatic: Bool {
        get { UserDefaults.standard.object(forKey: automaticKey) as? Bool ?? true }
        set {
            UserDefaults.standard.set(newValue, forKey: automaticKey)
            objectWillChange.send()
        }
    }

    /// Once a day, not every launch: a version check is not worth a request
    /// every time somebody opens a window.
    func checkIfDue() async {
        guard automatic else { return }
        if let lastChecked, Date().timeIntervalSince(lastChecked) < 86_400 { return }
        await check()
    }

    /// Keep it once a day for an app that is *left open*.
    ///
    /// `checkIfDue()` used to be called only from the main view's `.task`,
    /// which runs once when the window appears. An app open for a week
    /// therefore checked once, in the week's first minute, and a release cut
    /// the next morning went unmentioned until somebody quit and came back.
    ///
    /// Two triggers, because one is not enough. The timer covers an app left
    /// running; it does not fire while the machine is asleep and it coalesces,
    /// which is why becoming active covers the laptop that was shut overnight.
    /// Both funnel through `checkIfDue()`, so the day-old guard still decides
    /// and extra triggers cost nothing.
    func beginPeriodicChecks() {
        guard ticker == nil else { return }
        ticker = Timer.scheduledTimer(withTimeInterval: 3_600, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.checkIfDue() }
        }
        // Cheap enough to be generous with: waking, or coming back to the app
        // after a while, is exactly when a day is most likely to have passed.
        woke = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main,
        ) { [weak self] _ in
            Task { @MainActor in await self?.checkIfDue() }
        }
    }

    func check() async {
        guard !checking else { return }
        checking = true
        problem = nil
        defer { checking = false }

        // The API first, because it is the only source that marks a
        // prerelease. Its anonymous quota is sixty an hour per address and is
        // shared with every other tool on the machine, so a 403 here is
        // ordinary rather than exceptional — and is not a reason to show
        // nothing.
        var refusal: String?
        do {
            var request = URLRequest(url: endpoint)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.timeoutInterval = 12
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 200 {
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                keep(try decoder.decode([Release].self, from: data))
                return
            }
            refusal = "GitHub answered \(status)."
        } catch {
            refusal = error.localizedDescription
        }

        // The releases feed says the same thing from a different host, without
        // spending the API quota. It cannot mark a prerelease, which is why
        // anything read from it is shown but never used to announce an update.
        do {
            var request = URLRequest(url: feed)
            request.timeoutInterval = 12
            let (data, response) = try await URLSession.shared.data(for: request)
            if (response as? HTTPURLResponse)?.statusCode == 200,
               case let parsed = AtomReleases.parse(data), !parsed.isEmpty {
                keep(parsed)
                return
            }
        } catch {
            // Fall through to the message below: the feed failing too is worth
            // one sentence, not two.
        }

        // Both refused. Whatever was cached stays on screen — a stale list is
        // more use than an empty one, as long as it is labelled.
        problem = releases.isEmpty
            ? "\(refusal ?? "The check failed.") Could not reach the releases feed either. "
                + "Open the repository to see what is out."
            : "\(refusal ?? "The check failed.") Showing the last list this app was able to read"
                + (lastChecked.map { ", from \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "")
                + "."
    }

    /// One place where a successful read lands, so the cache and the timestamp
    /// can never disagree with what is on screen.
    private func keep(_ found: [Release]) {
        releases = found.sorted { $1.version < $0.version }
        problem = nil
        lastChecked = Date()
        UserDefaults.standard.set(lastChecked, forKey: checkedKey)

        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try? encoder.encode(releases).write(to: cache, options: .atomic)
    }

    // MARK: - Moving between versions

    /// Where this copy came from decides how it should be replaced. A cask
    /// knows how to verify what it downloads; a hand-placed app does not.
    enum Install {
        case homebrew
        case elsewhere(String)
    }

    var install: Install {
        let path = Bundle.main.bundlePath
        if path.contains("/Caskroom/") { return .homebrew }
        // A cask links its app into /Applications, so the receipt is the tell.
        if FileManager.default.fileExists(atPath: "/opt/homebrew/Caskroom/seo-audit")
            || FileManager.default.fileExists(atPath: "/usr/local/Caskroom/seo-audit") {
            return .homebrew
        }
        return .elsewhere(path)
    }

    /// The Homebrew command for a release, or `nil` when there is not one.
    ///
    /// There is one cask and it tracks the latest version, so Homebrew can move
    /// forward and cannot move back — `seo-audit@1.33.1` was offered for years
    /// and has never existed, so pressing Downgrade produced *"Error: No casks
    /// found"*. Found by trying it. An older release is reached by downloading
    /// its zip instead, which works for any version.
    func command(for release: Release) -> String? {
        Updates.brewCommand(from: current, to: release.version)
    }

    /// Pure, so the rule can be tested without a bundle version — under
    /// `swift test` `Bundle.main` is the test bundle and `current` is whatever
    /// that parses to, which is not a version anybody chose.
    nonisolated static func brewCommand(from current: Version, to target: Version) -> String? {
        current < target ? "brew upgrade --cask seo-audit" : nil
    }

    /// Run it in Terminal rather than silently: replacing an application while
    /// it runs is something somebody should watch happen, and Homebrew asks
    /// questions this app has no business answering on their behalf.
    func runInTerminal(_ command: String) {
        let script = "tell application \"Terminal\" to do script \"\(command)\"\n"
            + "tell application \"Terminal\" to activate"
        guard let apple = NSAppleScript(source: script) else { return }
        var error: NSDictionary?
        apple.executeAndReturnError(&error)
        if error != nil { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(command, forType: .string) }
    }

    func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func open(_ release: Release) {
        if let url = URL(string: release.htmlUrl) { NSWorkspace.shared.open(url) }
    }
}

// MARK: - Downloading a release

/// Where a download has got to, for a progress bar that means something.
///
/// `.downloading` carries a fraction only when the server said how big the file
/// is. GitHub does, but a proxy in the way may not, and a bar that sits at zero
/// and then jumps to done is worse than a spinner that admits it cannot say.
enum DownloadState: Equatable {
    case idle
    case downloading(fraction: Double?, received: Int64, total: Int64?)
    case unpacking
    case ready(URL)
    case failed(String)
}

// MARK: - Letting Homebrew do it, here rather than in Terminal

/// Where an upgrade has got to.
///
/// `.running` carries the last line Homebrew printed rather than a percentage:
/// `brew` reports its own progress in words, and inventing a bar over somebody
/// else's output would be a number this app made up.
/// What running something came to. A process that never started and one that
/// started and failed are different answers, and only the second has anything
/// to show for itself.
enum Ran: Equatable {
    case neverStarted(String)
    case finished(status: Int32, transcript: [String])
}

enum UpgradeState: Equatable {
    case idle
    case running(String)
    case done
    case failed(String)
}

extension Updates {
    /// Homebrew, if this machine has it.
    ///
    /// Looked for by path rather than by asking the shell: an app launched from
    /// the Finder inherits a minimal `PATH` with neither prefix on it, so
    /// `which brew` finds nothing and the update button would report Homebrew
    /// missing on a machine that installed the app *with* Homebrew.
    /// `nonisolated` because none of it touches the object: three pure
    /// functions, which is also what makes them testable without a window.
    nonisolated static func brewPath(
        exists: (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
    ) -> String? {
        ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"].first(where: exists)
    }

    /// What to run, as a program and its arguments.
    ///
    /// The same words `command(for:)` prints, split rather than re-decided —
    /// the string on screen and the process that runs have to be the same
    /// upgrade or the screen is lying.
    nonisolated static func brewArguments(for command: String) -> [String] {
        command.split(separator: " ").dropFirst().map(String.init)
    }

    /// A `PATH` Homebrew can work in.
    ///
    /// An app launched from the Finder gets almost none, and `brew` shells out
    /// to `curl`, `unzip`, `xattr` and its own Ruby. Handing it the prefix plus
    /// the system directories is the difference between an upgrade and a
    /// puzzling failure three steps in.
    nonisolated static func brewEnvironment(prefix: String, base: [String: String]) -> [String: String] {
        var environment = base
        let path = environment["PATH"] ?? ""
        environment["PATH"] = "\(prefix)/bin:/usr/bin:/bin:/usr/sbin:/sbin" + (path.isEmpty ? "" : ":\(path)")
        // Homebrew asks questions when it thinks somebody is watching, and
        // nobody is watching a subprocess of a window.
        environment["HOMEBREW_NO_AUTO_UPDATE"] = "1"
        environment["HOMEBREW_NO_ENV_HINTS"] = "1"
        environment["HOMEBREW_NO_ANALYTICS"] = "1"
        return environment
    }

    /// Run the upgrade here, streaming what Homebrew says.
    ///
    /// The button used to open Terminal and paste a command into it, which is a
    /// tool telling somebody how to update it rather than updating. Homebrew
    /// still does the part that matters — it verifies the download against the
    /// checksum the build wrote, and it keeps its own records straight, which
    /// is exactly why this app must not replace its own bundle behind its back.
    ///
    /// No `sudo`: the cask installs into `/Applications` and its postflight
    /// clears the quarantine flag without one, so nothing here can sit waiting
    /// for a password nobody can type.
    func upgrade(_ release: Release) async {
        guard let words = command(for: release).map(Updates.brewArguments) else {
            upgradeState = .failed("Homebrew has one cask and it tracks the latest version, so it can "
                                   + "move forward but not back. Download this release instead.")
            return
        }
        guard let brew = Updates.brewPath() else {
            upgradeState = .failed("Homebrew is not on this machine, so there is nothing to run. "
                                   + "The command is above if you want to run it yourself.")
            return
        }
        let prefix = brew.hasPrefix("/opt/homebrew") ? "/opt/homebrew" : "/usr/local"

        upgradeState = .running("Starting \(words.joined(separator: " "))…")

        let result = await Updates.stream(
            executable: brew,
            arguments: words,
            environment: Updates.brewEnvironment(prefix: prefix, base: ProcessInfo.processInfo.environment),
            onLine: { line in Task { @MainActor in self.upgradeState = .running(line) } },
        )

        switch result {
        case .neverStarted(let why):
            upgradeState = .failed(why)
        case .finished(0, _):
            upgradeState = .done
        case .finished(let status, let transcript):
            // Homebrew explains itself in its last few lines, and a failure
            // that shows only "exit 1" is a failure nobody can act on.
            let why = transcript.suffix(6).joined(separator: "\n")
            upgradeState = .failed(why.isEmpty ? "Homebrew exited \(status)." : why)
        }
    }

    /// Run something and watch it talk.
    ///
    /// Split out of `upgrade` because it is the part most likely to be wrong in
    /// a way nothing notices — an exit status read before the pipe drains, a
    /// line handler that never fires — and none of that is testable through a
    /// button. `onLine` gets every non-empty line as it arrives; the transcript
    /// comes back whole for the failure message.
    nonisolated static func stream(
        executable: String,
        arguments: [String],
        environment: [String: String],
        onLine: @escaping @Sendable (String) -> Void,
    ) async -> Ran {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: executable)
        task.arguments = arguments
        task.environment = environment

        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = pipe

        do {
            try task.run()
        } catch {
            return .neverStarted("Could not start \(executable): \(error.localizedDescription)")
        }

        var transcript: [String] = []
        do {
            for try await line in pipe.fileHandleForReading.bytes.lines {
                // Bounded: a long upgrade prints hundreds of lines and only the
                // last few are ever shown.
                transcript.append(line)
                if transcript.count > 200 { transcript.removeFirst() }
                // A line of spaces, since `AsyncLineSequence` has already
                // dropped the empty ones. A progress label that blinks blank
                // is worse than one that stands still.
                let shown = line.trimmingCharacters(in: .whitespaces)
                if !shown.isEmpty { onLine(shown) }
            }
        } catch {
            // The pipe closing is how a finished process ends. The exit status
            // is what decides whether this worked, so it is read either way.
        }

        task.waitUntilExit()
        return .finished(status: task.terminationStatus, transcript: transcript)
    }

    /// Quit, and come back as the version that was just installed.
    ///
    /// The running process still holds the old bundle's files; the path now
    /// points at the new one, so opening it after this process is gone is what
    /// makes the swap visible. The sleep is for the quit to finish — `open` on
    /// a path an app still occupies would just bring the old one forward.
    func relaunch() {
        let path = Bundle.main.bundlePath
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/sh")
        task.arguments = ["-c", "sleep 1.5; open \"\(path)\""]
        try? task.run()
        NSApp.terminate(nil)
    }
}

extension Updates {
    /// Fetch a release's zip, unpack it, and reveal it.
    ///
    /// Deliberately not a self-replacing updater. Replacing a *running* bundle
    /// safely needs a helper process outliving the app it is overwriting, which
    /// is Sparkle's entire job — and if Homebrew installed this, overwriting the
    /// bundle behind its back leaves its records describing a version that is no
    /// longer there. So this does the slow part, and hands over.
    ///
    /// Where Homebrew *can* do it, `upgrade` does it here instead, and the last
    /// step is a Relaunch rather than a drag.
    func download(_ release: Release) async {
        // A cask install has one correct answer for a *newer* version and it is
        // Homebrew, which now runs in the window rather than in Terminal. Going
        // backwards has no cask at all, so the zip is the only route — and it
        // works for any version, which is why this is not gated on the install.
        if case .homebrew = install, command(for: release) != nil {
            await upgrade(release)
            return
        }
        guard let url = release.downloadUrl else {
            downloadState = .failed("That release has no macOS build attached.")
            return
        }

        downloadState = .downloading(fraction: nil, received: 0, total: nil)
        do {
            let (bytes, response) = try await URLSession.shared.bytes(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                downloadState = .failed("GitHub answered \((response as? HTTPURLResponse)?.statusCode ?? 0).")
                return
            }
            let total = response.expectedContentLength > 0 ? response.expectedContentLength : nil

            var data = Data()
            if let total { data.reserveCapacity(Int(total)) }
            var lastShown = Date.distantPast
            for try await byte in bytes {
                data.append(byte)
                // Publishing every byte would spend the download redrawing a
                // bar. Ten times a second is smooth and costs nothing.
                if Date().timeIntervalSince(lastShown) > 0.1 {
                    lastShown = Date()
                    downloadState = .downloading(
                        fraction: total.map { Double(data.count) / Double($0) },
                        received: Int64(data.count),
                        total: total,
                    )
                }
            }

            downloadState = .unpacking
            let staging = FileManager.default.temporaryDirectory
                .appendingPathComponent("seo-audit-update-\(release.version.description)")
            try? FileManager.default.removeItem(at: staging)
            try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
            let zip = staging.appendingPathComponent("app.zip")
            try data.write(to: zip)

            // ditto, because ditto is what wrote it: it keeps the bundle's
            // symlinks and its signature, and plain unzip does not.
            let unzip = Process()
            unzip.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
            unzip.arguments = ["-x", "-k", zip.path, staging.path]
            try unzip.run()
            unzip.waitUntilExit()
            guard unzip.terminationStatus == 0 else {
                downloadState = .failed("The download did not unpack. It may have been truncated.")
                return
            }

            let unpacked = (try? FileManager.default.contentsOfDirectory(at: staging, includingPropertiesForKeys: nil))?
                .first { $0.pathExtension == "app" }
            guard let unpacked else {
                downloadState = .failed("No application inside the download.")
                return
            }
            downloadState = .ready(unpacked)
        } catch {
            downloadState = .failed(error.localizedDescription)
        }
    }

    /// Show it, rather than install it. The last step is a drag somebody makes
    /// deliberately, which is also the step where macOS asks whether they meant
    /// to replace a running application.
    func reveal(_ app: URL) {
        NSWorkspace.shared.activateFileViewerSelecting([app])
    }
}
