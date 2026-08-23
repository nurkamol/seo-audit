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

    private let endpoint = URL(string: "https://api.github.com/repos/nurkamol/seo-audit/releases?per_page=30")!
    /// The same releases as an Atom feed, served by github.com rather than
    /// api.github.com — so it does not spend the sixty-an-hour anonymous API
    /// quota, which is per address and shared with every other tool on the
    /// machine that talks to GitHub.
    private let feed = URL(string: "https://github.com/nurkamol/seo-audit/releases.atom")!
    private let checkedKey = "seo-audit.updates.lastChecked"
    private let automaticKey = "seo-audit.updates.automatic"
    private let cache: URL

    var current: Version {
        Version(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")
    }

    var newest: Release? {
        releases.filter { !$0.prerelease }.max { $0.version < $1.version }
    }

    var available: Release? {
        // A feed-sourced list cannot tell a prerelease from a release, so it is
        // never allowed to announce an update. Showing the list is useful;
        // pushing somebody onto a prerelease because the feed did not say so is
        // the same false positive this project refuses in its reports.
        guard let newest, !newest.fromFeed, current < newest.version else { return nil }
        return newest
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

    func command(for release: Release) -> String {
        let version = release.version.description
        return current < release.version
            ? "brew upgrade --cask seo-audit"
            : "brew install --cask nurkamol/seo-audit/seo-audit@\(version)"
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
