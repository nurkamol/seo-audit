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

    var id: String { tagName }
    var version: Version { Version(tagName) }
    var title: String { name ?? tagName }

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case name, body, prerelease
        case publishedAt = "published_at"
        case htmlUrl = "html_url"
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
    private let checkedKey = "seo-audit.updates.lastChecked"

    var current: Version {
        Version(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")
    }

    var newest: Release? {
        releases.filter { !$0.prerelease }.max { $0.version < $1.version }
    }

    var available: Release? {
        guard let newest, current < newest.version else { return nil }
        return newest
    }

    init() {
        lastChecked = UserDefaults.standard.object(forKey: checkedKey) as? Date
    }

    /// Once a day, not every launch: a version check is not worth a request
    /// every time somebody opens a window.
    func checkIfDue() async {
        if let lastChecked, Date().timeIntervalSince(lastChecked) < 86_400 { return }
        await check()
    }

    func check() async {
        guard !checking else { return }
        checking = true
        problem = nil
        defer { checking = false }

        do {
            var request = URLRequest(url: endpoint)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.timeoutInterval = 12
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                // Unauthenticated GitHub allows sixty requests an hour per
                // address, and saying so is more use than "something failed".
                problem = "GitHub answered \((response as? HTTPURLResponse)?.statusCode ?? 0). "
                    + "Unauthenticated checks are limited to sixty an hour."
                return
            }
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            releases = try decoder.decode([Release].self, from: data)
                .sorted { $1.version < $0.version }
            lastChecked = Date()
            UserDefaults.standard.set(lastChecked, forKey: checkedKey)
        } catch {
            problem = error.localizedDescription
        }
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
