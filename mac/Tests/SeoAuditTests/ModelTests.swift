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
        #expect(ExportFormat.sitemap.fileExtension == "xml")
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
        // `sitemap-out` is not a setting: rebuilding the sitemap needs per-page
        // data that is gone by the time the report arrives, so it is always
        // asked for and costs one already-cached request.
        #expect(names == ["url", "limit", "format", "sitemap-out"])
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

@Suite("One app, one folder")
struct SupportTests {
    @Test("the library and the version cache land in the same place")
    func oneHome() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("seo-audit-support-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        // Both went through their own copy of this once, and disagreed about
        // capitalisation — so the app had two homes and neither was the real one.
        let first = Support.directory(root)
        let second = Support.directory(root)
        #expect(first == second)
        #expect(FileManager.default.fileExists(atPath: first.path), "it creates what it returns")
    }

    @MainActor
    @Test("a report kept and a release cached share a directory")
    func shared() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("seo-audit-support-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let url = try #require(Bundle.module.url(forResource: "payload", withExtension: "json"))
        let raw = try Data(contentsOf: url)
        let library = Library(root: root)
        _ = library.keep(try JSONDecoder().decode(Report.self, from: raw), site: "https://x.test", raw: raw)
        _ = Updates(root: root)

        let contents = try FileManager.default.contentsOfDirectory(atPath: root.path)
        #expect(contents.contains("reports"))
        #expect(contents.contains("index.json"))
        // Nothing with the display name in it — that name is for people, and it
        // has already changed once.
        #expect(!contents.contains { $0.contains("SEO Audit") })
    }
}

@Suite("Two runs of one site")
struct ComparisonTests {
    @MainActor
    private func library() throws -> (Library, URL, Data) {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("seo-audit-compare-\(UUID().uuidString)")
        let url = try #require(Bundle.module.url(forResource: "payload", withExtension: "json"))
        return (Library(root: root), root, try Data(contentsOf: url))
    }

    @MainActor
    @Test("a run is never offered as something to compare itself with")
    func neverItself() throws {
        let (library, root, raw) = try library()
        defer { try? FileManager.default.removeItem(at: root) }
        let report = try JSONDecoder().decode(Report.self, from: raw)

        let first = library.keep(report, site: "https://a.test", raw: raw,
                                 at: Date(timeIntervalSince1970: 1_000))
        let second = library.keep(report, site: "https://a.test", raw: raw,
                                  at: Date(timeIntervalSince1970: 2_000))
        _ = library.keep(report, site: "https://b.test", raw: raw,
                         at: Date(timeIntervalSince1970: 3_000))

        let offered = library.otherRuns(of: "a.test", besides: second)
        #expect(offered.map(\.id) == [first.id], "only the other run of the same site")
        #expect(library.otherRuns(of: "b.test", besides: nil).count == 1)
        // The first audit of a site has nothing to compare against, and the
        // menu says so rather than being absent.
        #expect(library.otherRuns(of: "a.test", besides: first).map(\.id) == [second.id])
    }

    @MainActor
    @Test("newest first, so the obvious comparison is the top of the menu")
    func ordering() throws {
        let (library, root, raw) = try library()
        defer { try? FileManager.default.removeItem(at: root) }
        let report = try JSONDecoder().decode(Report.self, from: raw)

        let old = library.keep(report, site: "https://a.test", raw: raw, at: Date(timeIntervalSince1970: 1_000))
        let mid = library.keep(report, site: "https://a.test", raw: raw, at: Date(timeIntervalSince1970: 2_000))
        let new = library.keep(report, site: "https://a.test", raw: raw, at: Date(timeIntervalSince1970: 3_000))

        #expect(library.otherRuns(of: "a.test", besides: new).map(\.id) == [mid.id, old.id])
        #expect(library.mostRecent(of: "a.test")?.id == new.id)
        #expect(library.mostRecent(of: "nothing.test") == nil)
    }

    @Test("what the engine sends back decodes, grouping included")
    func decodes() throws {
        let payload = Data("""
        {
          "previousDate": "2026-08-17",
          "unchanged": 12,
          "added": {
            "findings": [{"level":"error","id":"h1-missing","title":"No <h1>","detail":"d","url":"https://a.test/x"}],
            "causes": [{"id":"h1-missing","title":"No <h1>","level":"error","section":"/","count":1,
                        "pages":["https://a.test/x"],"scope":"once","area":"Content"}]
          },
          "fixed": { "findings": [], "causes": [] }
        }
        """.utf8)

        let comparison = try JSONDecoder().decode(Comparison.self, from: payload)
        #expect(comparison.unchanged == 12)
        #expect(comparison.previousDate == "2026-08-17")
        #expect(comparison.added.causes.count == 1)
        #expect(comparison.added.causes.first?.scope == "once")
        #expect(comparison.fixed.causes.isEmpty)
        #expect(!comparison.isUnchanged, "something appeared, so something moved")
    }

    @Test("a run where nothing moved says so rather than showing two empty lists")
    func nothingMoved() throws {
        let payload = Data("""
        {"previousDate":"2026-08-17","unchanged":40,
         "added":{"findings":[],"causes":[]},"fixed":{"findings":[],"causes":[]}}
        """.utf8)
        #expect(try JSONDecoder().decode(Comparison.self, from: payload).isUnchanged)
    }
}

@Suite("Before spending the minutes")
struct PreviewTests {
    @Test("what the engine sends back decodes")
    func decodes() throws {
        let payload = Data("""
        {"origin":"https://a.test","reachable":true,"rateLimited":false,
         "sitemap":"https://a.test/sitemap.xml","listed":210,"wouldCheck":25,
         "skippedByLimit":185,"limit":25,"requests":3,"ms":1300,
         "sections":[{"path":"/docs/","count":35},{"path":"/news/","count":18}],
         "sample":["https://a.test/one"]}
        """.utf8)
        let plan = try JSONDecoder().decode(Preview.self, from: payload)
        #expect(plan.listed == 210)
        #expect(plan.wouldCheck == 25)
        #expect(plan.skippedByLimit == 185)
        #expect(plan.sections.first?.path == "/docs/")
        #expect(plan.requests == 3, "a handful, which is the whole point")
    }

    @Test("a site with no sitemap comes back without a made-up count")
    func noSitemap() throws {
        let payload = Data("""
        {"origin":"https://a.test","reachable":true,"rateLimited":false,"sitemap":null,
         "listed":0,"wouldCheck":null,"skippedByLimit":0,"limit":200,"requests":3,"ms":900,
         "sections":[],"sample":[]}
        """.utf8)
        let plan = try JSONDecoder().decode(Preview.self, from: payload)
        #expect(plan.sitemap == nil)
        #expect(plan.wouldCheck == nil, "following links cannot know in advance")
        #expect(plan.reachable)
    }

    @MainActor
    @Test("a user agent of your own replaces the presets rather than joining them")
    func ownAgent() {
        let settings = CrawlSettings()
        settings.browser = "chrome"
        settings.system = "macos"
        settings.userAgent = "  MyBot/1.0  "
        defer { settings.browser = ""; settings.system = ""; settings.userAgent = "" }

        let items = settings.queryItems(for: Run(url: "https://a.test", limit: 10))
        let byName = Dictionary(items.map { ($0.name, $0.value) }, uniquingKeysWith: { a, _ in a })
        #expect(byName["userAgent"] == "MyBot/1.0", "trimmed")
        // Sending all three would leave the engine to guess which was meant.
        #expect(byName["browser"] == nil)
        #expect(byName["os"] == nil)

        settings.userAgent = "   "
        let fallback = settings.queryItems(for: Run(url: "https://a.test", limit: 10))
        #expect(fallback.contains { $0.name == "browser" }, "whitespace is not a user agent")
    }
}

@Suite("The corrected sitemap, carried with the report")
struct RebuiltSitemapTests {
    @Test("a written one arrives with what it did")
    func written() throws {
        let payload = Data("""
        {"xml":"<?xml version=\\"1.0\\"?>","urls":["https://a.test/one"],
         "added":["https://a.test/one"],"refused":null}
        """.utf8)
        let sitemap = try JSONDecoder().decode(RebuiltSitemap.self, from: payload)
        #expect(sitemap.xml != nil)
        #expect(sitemap.added == ["https://a.test/one"])
        #expect(sitemap.refused == nil)
    }

    @Test("a refusal carries its reason, which is the useful half")
    func refused() throws {
        let payload = Data("""
        {"xml":null,"urls":[],"added":[],
         "refused":"The crawl stopped at its limit with 185 URL(s) unread."}
        """.utf8)
        let sitemap = try JSONDecoder().decode(RebuiltSitemap.self, from: payload)
        #expect(sitemap.xml == nil, "and the menu item is disabled on exactly this")
        #expect(sitemap.refused?.contains("185") == true)
    }

    @Test("a report from before this existed still opens")
    func absent() throws {
        let url = try #require(Bundle.module.url(forResource: "payload", withExtension: "json"))
        let report = try JSONDecoder().decode(Report.self, from: Data(contentsOf: url))
        #expect(report.sitemap == nil)
        #expect(!report.findings.isEmpty, "the rest of it decoded fine")
    }

    @MainActor
    @Test("a run always asks for one")
    func alwaysAsked() {
        let items = CrawlSettings().queryItems(for: Run(url: "https://a.test", limit: 10))
        #expect(items.contains { $0.name == "sitemap-out" && $0.value == "1" })
    }
}

@Suite("Silencing a check, and asking Google")
struct SilenceAndPerformanceTests {
    @MainActor
    private func fresh() -> CrawlSettings {
        let settings = CrawlSettings()
        settings.ignored = []
        settings.performance = .off
        settings.performanceSample = 3
        settings.performanceOnDesktop = false
        return settings
    }

    @MainActor
    @Test("silencing survives, deduplicates, and can be undone")
    func silence() {
        let settings = fresh()
        defer { settings.ignored = [] }

        settings.silence("thin-content")
        settings.silence("img-srcset")
        settings.silence("thin-content")          // twice from two cards
        #expect(settings.ignored == ["img-srcset", "thin-content"], "sorted, and once each")
        #expect(settings.isSilenced("thin-content"))

        let items = settings.queryItems(for: Run(url: "https://a.test", limit: 10))
        #expect(items.first { $0.name == "ignore" }?.value == "img-srcset,thin-content")

        settings.unsilence("thin-content")
        #expect(settings.ignored == ["img-srcset"])
        #expect(!settings.isSilenced("thin-content"))
    }

    @MainActor
    @Test("silencing nothing sends nothing")
    func noneSilenced() {
        let settings = fresh()
        let items = settings.queryItems(for: Run(url: "https://a.test", limit: 10))
        #expect(!items.contains { $0.name == "ignore" })
    }

    @MainActor
    @Test("performance is off unless asked for, and sampled when it is")
    func performance() {
        let settings = fresh()
        defer { settings.performance = .off; settings.performanceOnDesktop = false }

        // Off is off: no psi parameter at all, so the engine's default holds.
        #expect(!settings.queryItems(for: Run(url: "https://a.test", limit: 10)).contains { $0.name.hasPrefix("psi") })

        settings.performance = .homepage
        var byName = Dictionary(settings.queryItems(for: Run(url: "https://a.test", limit: 10))
            .map { ($0.name, $0.value) }, uniquingKeysWith: { a, _ in a })
        #expect(byName["psi"] == "/")
        #expect(byName["psi-sample"] == nil, "one page is not a sample")
        #expect(byName["psi-strategy"] == nil, "mobile is the engine's default")

        settings.performance = .sample
        settings.performanceSample = 5
        settings.performanceOnDesktop = true
        byName = Dictionary(settings.queryItems(for: Run(url: "https://a.test", limit: 10))
            .map { ($0.name, $0.value) }, uniquingKeysWith: { a, _ in a })
        #expect(byName["psi"] == "/**")
        #expect(byName["psi-sample"] == "5")
        #expect(byName["psi-strategy"] == "desktop")
    }

    @Test("every performance mode says what it means")
    func described() {
        #expect(CrawlSettings.Performance.off.targets.isEmpty)
        for mode in CrawlSettings.Performance.allCases {
            #expect(!mode.label.isEmpty)
        }
    }
}

@Suite("What a cause card can say about a group")
struct SharedDetailTests {
    private func finding(_ url: String, _ detail: String) -> Finding {
        let json = """
        {"level":"warn","id":"desc-long","title":"Meta description will be cut off",
         "detail":"\(detail)","url":"\(url)"}
        """
        return try! JSONDecoder().decode(Finding.self, from: Data(json.utf8))
    }

    @Test("one detail for the whole group is shown once")
    func shared() {
        let group = [finding("https://a.test/one", "Missing entirely."),
                     finding("https://a.test/two", "Missing entirely.")]
        let first = group.first!.detail
        #expect(group.allSatisfy { $0.detail == first }, "identical, so it describes the group")
    }

    @Test("details that differ are not one page's number standing for everybody's")
    func differing() {
        // The bug this replaced: the card printed the first finding's line above
        // every page, so "267 chars (limit ~160)" appeared over a page that was
        // 202 characters long.
        let group = [finding("https://a.test/one", "267 chars (limit ~160)"),
                     finding("https://a.test/two", "202 chars (limit ~160)")]
        let first = group.first!.detail
        #expect(!group.allSatisfy { $0.detail == first }, "so each page shows its own")
        #expect(Set(group.map(\.detail)).count == 2)
    }
}
