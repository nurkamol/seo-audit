// What the app can be tested on without pretending a window exists.
//
// The models, the parsing, the versioning and the library — the parts that can
// be wrong quietly. The views are deliberately not tested: a snapshot of a
// glass card asserts what the design happens to be today and fails every time
// it improves, which teaches a team to delete tests.
//
// The payload fixture is a real one, captured from the engine. It is the test
// that matters most here, because the way this app breaks is the engine
// changing its output and nothing noticing until somebody opens a window.

import Testing
import Foundation
@testable import SeoAudit

@Suite("Decoding what the engine actually sends")
struct PayloadTests {
    private func fixture() throws -> Data {
        let url = try #require(Bundle.module.url(forResource: "payload", withExtension: "json"))
        return try Data(contentsOf: url)
    }

    @Test("a real engine payload decodes")
    func decodes() throws {
        let report = try JSONDecoder().decode(Report.self, from: fixture())

        #expect(report.meta.pages > 0)
        #expect(!report.findings.isEmpty)
        #expect(!report.causes.isEmpty)
        // Grouping happens in the engine; the app must never be the thing that
        // decides what one piece of work is.
        #expect(report.causes.count <= report.findings.count)
    }

    @Test("every finding carries what the report needs to draw it")
    func fields() throws {
        let report = try JSONDecoder().decode(Report.self, from: fixture())
        for finding in report.findings {
            #expect(!finding.id.isEmpty)
            #expect(!finding.title.isEmpty)
            #expect(!finding.detail.isEmpty)
        }
        // Reach is what the ordering is built on, so its absence everywhere
        // would mean the app silently ranks by nothing.
        #expect(report.findings.contains { $0.reach != nil })
    }

    @Test("every cause says which area fixes it, and the areas group")
    func areas() throws {
        let report = try JSONDecoder().decode(Report.self, from: fixture())
        // The engine decides this. If the app ever had to work it out from the
        // check id, that table would exist twice and drift.
        for cause in report.causes {
            #expect(!(cause.area ?? "").isEmpty, "\(cause.id) arrived with no area")
        }
        let grouped = report.byArea
        #expect(grouped.count > 1, "a real report spans more than one area")
        #expect(grouped.flatMap(\.causes).count == report.causes.count, "no cause is lost in grouping")
        // Grouping must not reorder within an area — the engine put the worst
        // first and the PDF prints them in that order.
        for area in grouped {
            let indices = area.causes.compactMap { c in report.causes.firstIndex { $0.identity == c.identity } }
            #expect(indices == indices.sorted())
        }
    }

    @Test("a cause's pages are findings the report can actually show")
    func causesResolve() throws {
        let report = try JSONDecoder().decode(Report.self, from: fixture())
        for cause in report.causes {
            #expect(!cause.scope.isEmpty, "the engine writes the scope line, and the app prints it verbatim")
            #expect(!report.findings(for: cause).isEmpty, "\(cause.id) in \(cause.section) matched nothing")
        }
    }

    @Test("counts agree with the findings they count")
    func counts() throws {
        let report = try JSONDecoder().decode(Report.self, from: fixture())
        let counts = report.counts
        #expect(counts.error + counts.warn + counts.info == report.findings.count)
    }

    @Test("a payload this app cannot read fails rather than half-decodes")
    func rejectsNonsense() {
        let broken = Data(#"{"meta":{"origin":"x"},"findings":[]}"#.utf8)
        #expect(throws: (any Error).self) { try JSONDecoder().decode(Report.self, from: broken) }
    }
}

@Suite("What somebody types")
struct RunTests {
    @Test("a bare hostname is what people type, and is accepted")
    func normalises() {
        #expect(Run.normalise("example.com") == "https://example.com")
        #expect(Run.normalise("  example.com  ") == "https://example.com")
        #expect(Run.normalise("https://example.com/blog") == "https://example.com/blog")
        #expect(Run.normalise("http://example.com") == "http://example.com")
    }

    @Test("something that is not a site is refused")
    func refuses() {
        #expect(Run.normalise("") == nil)
        #expect(Run.normalise("   ") == nil)
        // No dot, no host: "localhost" would be a fair thing to want one day,
        // but silently auditing nothing is not.
        #expect(Run.normalise("nonsense") == nil)
    }

    @Test("the host is what the window is titled with")
    func host() {
        #expect(Run(url: "https://www.example.com/a", limit: 10).host == "www.example.com")
    }
}

@Suite("Version ordering")
struct VersionTests {
    @Test("versions compare by number, not by string")
    func ordering() {
        // "1.9.0" > "1.10.0" is the classic string-sort bug, and it would offer
        // a downgrade as an update.
        #expect(Version("1.9.0") < Version("1.10.0"))
        #expect(Version("v1.22.0") == Version("1.22.0"))
        #expect(Version("2.0.0") > Version("1.99.99"))
        #expect(Version("1.2") < Version("1.2.1"))
        #expect(Version("1.2.0") == Version("1.2"))
    }

    @Test("a tag this cannot parse sorts oldest, so it never claims to be an update")
    func unparseable() {
        #expect(Version("nightly") < Version("0.0.1"))
    }
}

@Suite("Reports kept on disk")
struct LibraryTests {
    private func sample() throws -> (Report, Data) {
        let url = try #require(Bundle.module.url(forResource: "payload", withExtension: "json"))
        let data = try Data(contentsOf: url)
        return (try JSONDecoder().decode(Report.self, from: data), data)
    }

    @MainActor
    @Test("a kept report comes back byte for byte")
    func roundTrip() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("seo-audit-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let library = Library(root: root)
        let (report, raw) = try sample()
        let stored = library.keep(report, site: "https://example.com", raw: raw)

        #expect(library.reports.count == 1)
        #expect(stored.host == "example.com")
        #expect(stored.pages == report.meta.pages)

        let reopened = try #require(library.reopen(stored))
        #expect(reopened.1 == raw, "what was written must be what the engine sent")
        #expect(reopened.0.findings.count == report.findings.count)

        // A second Library over the same folder is what a relaunch is.
        let relaunched = Library(root: root)
        #expect(relaunched.reports.count == 1)
        #expect(relaunched.reports.first?.id == stored.id)

        library.forget(stored)
        #expect(library.reports.isEmpty)
        #expect(Library(root: root).reports.isEmpty)
    }

    @MainActor
    @Test("an index entry whose file is gone is not listed")
    func missingFile() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("seo-audit-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let library = Library(root: root)
        let (report, raw) = try sample()
        let stored = library.keep(report, site: "https://example.com", raw: raw)

        // Somebody emptied the folder, or a sync tool did.
        try FileManager.default.removeItem(at: root.appendingPathComponent("reports/\(stored.filename)"))
        #expect(Library(root: root).reports.isEmpty, "a row that opens onto nothing is worse than no row")
    }
}

@Suite("Export formats")
struct ExportTests {
    @Test("every format has a file extension and a type that agree")
    func extensions() {
        #expect(ExportFormat.csv.fileExtension == "csv")
        #expect(ExportFormat.markdown.fileExtension == "md")
        for format in ExportFormat.allCases {
            #expect(!format.label.isEmpty)
            #expect(!format.detail.isEmpty)
            #expect(!format.symbol.isEmpty)
        }
    }
}

@Suite("The releases feed, when the API refuses")
struct AtomTests {
    private func feed() throws -> Data {
        let url = try #require(Bundle.module.url(forResource: "releases", withExtension: "atom"))
        return try Data(contentsOf: url)
    }

    @Test("a real GitHub releases feed parses")
    func parses() throws {
        let releases = AtomReleases.parse(try feed())

        #expect(!releases.isEmpty, "the feed the API falls back to has to actually yield releases")
        for release in releases {
            #expect(release.tagName.contains { $0.isNumber }, "\(release.tagName) cannot be ordered")
            #expect(release.htmlUrl.hasPrefix("https://github.com/"))
            #expect(release.publishedAt != nil, "a row with no date sorts wrong in the sidebar")
            // Every one of these is shown but must never announce an update:
            // the feed does not say what is a prerelease.
            #expect(release.fromFeed)
        }
        #expect(releases.contains { $0.version == Version("1.23.0") })
    }

    @Test("the notes come through as text, not as markup")
    func notes() throws {
        let releases = AtomReleases.parse(try feed())
        let withNotes = try #require(releases.first { !($0.body ?? "").isEmpty })
        let body = try #require(withNotes.body)
        #expect(!body.contains("<p>"), "the sheet draws this as plain text")
        #expect(!body.contains("&lt;"), "entities are decoded once")
    }

    @Test("markup becomes readable text and entities decode once")
    func plainText() {
        #expect(AtomReleases.plainText("<p>one</p><p>two</p>") == "one\ntwo")
        #expect(AtomReleases.plainText("<ul><li>a</li><li>b</li></ul>") == "• a\n• b")
        // `&amp;lt;` is an escaped entity in the notes; decoding &amp; first
        // would turn it into a tag on the second pass.
        #expect(AtomReleases.plainText("a &amp;lt; b") == "a &lt; b")
        #expect(AtomReleases.plainText("") == "")
    }

    @Test("rubbish parses to nothing rather than to a row that cannot be ordered")
    func rubbish() {
        #expect(AtomReleases.parse(Data("not xml".utf8)).isEmpty)
        #expect(AtomReleases.parse(Data(#"<feed><entry><title>x</title></entry></feed>"#.utf8)).isEmpty)
    }

    @Test("a feed-sourced list never announces an update")
    func neverAnnounces() throws {
        let releases = AtomReleases.parse(try feed())
        // Version 0 is older than everything, so if a feed list could announce
        // an update it certainly would here.
        #expect(releases.allSatisfy { $0.fromFeed })
        #expect(releases.filter { !$0.prerelease && !$0.fromFeed }.isEmpty)
    }
}

@Suite("The version list survives GitHub saying no")
struct UpdatesCacheTests {
    @MainActor
    @Test("a cached list is there before any network call")
    func loadsCache() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("seo-audit-updates-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        // Written the way `keep()` writes it.
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let stored = [
            Release(tagName: "v1.23.0", name: "1.23.0", body: "notes", publishedAt: Date(),
                    htmlUrl: "https://github.com/nurkamol/seo-audit/releases/tag/v1.23.0",
                    prerelease: false),
        ]
        try encoder.encode(stored).write(to: root.appendingPathComponent("releases.json"))

        // The 403 that prompted this left the sheet empty on every launch,
        // because nothing was ever kept.
        let updates = Updates(root: root)
        #expect(updates.releases.count == 1)
        #expect(updates.releases.first?.tagName == "v1.23.0")
        #expect(!updates.listIsPartial, "an API-sourced list answers questions a feed one cannot")
    }

    @MainActor
    @Test("no cache is an empty list, not a crash")
    func noCache() {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("seo-audit-updates-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let updates = Updates(root: root)
        #expect(updates.releases.isEmpty)
        #expect(!updates.listIsPartial, "nothing to show is not a partial list")
    }
}

@Suite("The PDF export")
struct PDFTests {
    @MainActor
    @Test("a real report becomes a paginated PDF that carries the findings")
    func writes() throws {
        let url = try #require(Bundle.module.url(forResource: "payload", withExtension: "json"))
        let report = try JSONDecoder().decode(Report.self, from: Data(contentsOf: url))

        let out = ProcessInfo.processInfo.environment["SEO_AUDIT_PDF_OUT"].map(URL.init(fileURLWithPath:))
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
                .appendingPathComponent("seo-audit-\(UUID().uuidString).pdf")
        defer {
            // Kept when a path was asked for, so the export can be looked at.
            if ProcessInfo.processInfo.environment["SEO_AUDIT_PDF_OUT"] == nil {
                try? FileManager.default.removeItem(at: out)
            }
        }

        PDF.write(report: report, host: "https://jekyllrb.com", to: out)

        let document = try #require(PDFishDocument(url: out))
        // The bug this replaced: one page as tall as the whole report.
        #expect(document.pageCount >= 1)
        #expect(document.height <= 900, "every page is A4, not one strip the height of the report")

        let text = document.text
        #expect(text.contains("jekyllrb.com"))
        #expect(text.contains("Things to change"))
        // The detail and the pages, which the summary-only version dropped.
        let cause = try #require(report.causes.first)
        #expect(text.contains(cause.title))
        if let finding = report.findings(for: cause).first, let page = finding.url {
            #expect(text.contains(page) || text.contains(String(page.suffix(20))))
        }
    }
}

/// Enough of PDFKit to check the export, kept here so the app itself does not
/// link a framework it has no other use for.
import PDFKit
struct PDFishDocument {
    let inner: PDFDocument
    init?(url: URL) { guard let d = PDFDocument(url: url) else { return nil }; inner = d }
    var pageCount: Int { inner.pageCount }
    var height: CGFloat { inner.page(at: 0)?.bounds(for: .mediaBox).height ?? 0 }
    var text: String { inner.string ?? "" }
}

@Suite("What a run is made of")
struct CrawlSettingsTests {
    @MainActor
    private func fresh() -> CrawlSettings {
        // @AppStorage reads the shared defaults, so a test has to put back what
        // it changes or the next one starts somewhere unexpected.
        let settings = CrawlSettings()
        settings.speed = .normal
        settings.limit = 200
        settings.checkExternal = false
        settings.browser = ""
        settings.system = ""
        settings.sitemap = ""
        return settings
    }

    @MainActor
    @Test("defaults send nothing but the run itself")
    func defaults() {
        let items = fresh().queryItems(for: Run(url: "https://x.test", limit: 200))
        let names = Set(items.map(\.name))
        // Sending concurrency=6 explicitly would move the default out of the
        // engine and into this app, where changing it later would not take.
        #expect(names == ["url", "limit", "format"])
        #expect(items.first { $0.name == "format" }?.value == "json")
    }

    @MainActor
    @Test("gentle is the setting that gets through a rate limit")
    func gentle() {
        let settings = fresh()
        settings.speed = .gentle
        defer { settings.speed = .normal }
        let items = settings.queryItems(for: Run(url: "https://x.test", limit: 10))
        #expect(items.first { $0.name == "concurrency" }?.value == "1")
        #expect(CrawlSettings.Speed.gentle.connections < CrawlSettings.Speed.normal.connections)
        #expect(CrawlSettings.Speed.normal.connections < CrawlSettings.Speed.fast.connections)
    }

    @MainActor
    @Test("everything set reaches the engine, and blank fields do not")
    func everything() {
        let settings = fresh()
        settings.checkExternal = true
        settings.browser = "googlebot"
        settings.system = "macos"
        settings.sitemap = "   "        // whitespace is not a sitemap
        defer {
            settings.checkExternal = false
            settings.browser = ""
            settings.system = ""
            settings.sitemap = ""
        }

        let items = settings.queryItems(for: Run(url: "https://x.test", limit: 10))
        let byName = Dictionary(items.map { ($0.name, $0.value) }, uniquingKeysWith: { a, _ in a })
        #expect(byName["external"] == "1")
        #expect(byName["browser"] == "googlebot")
        #expect(byName["os"] == "macos")
        #expect(byName["sitemap"] == nil, "a field of spaces is empty")

        settings.sitemap = "  /sitemaps/all.xml  "
        let trimmed = settings.queryItems(for: Run(url: "https://x.test", limit: 10))
        #expect(trimmed.first { $0.name == "sitemap" }?.value == "/sitemaps/all.xml")
    }

    @MainActor
    @Test("every speed says what it does, in words rather than a number")
    func described() {
        for speed in CrawlSettings.Speed.allCases {
            #expect(!speed.label.isEmpty)
            #expect(!speed.detail.isEmpty)
            #expect(speed.connections >= 1)
        }
    }
}
