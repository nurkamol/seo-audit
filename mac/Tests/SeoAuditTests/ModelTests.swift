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
