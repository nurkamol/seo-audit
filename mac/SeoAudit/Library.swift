// Reports, kept.
//
// A 325-page site takes seven minutes to crawl. Losing that because a window
// was closed is the difference between a tool somebody opens twice and a tool
// somebody opens once. Every finished run is written to disk as the exact JSON
// the engine produced — not this app's idea of it — so a report saved by one
// version still opens in the next, and so `jq` works on it.

import Foundation

/// One stored report: enough to list it without reading the whole file.
struct StoredReport: Identifiable, Hashable, Codable {
    let id: UUID
    let host: String
    let site: String
    let finishedAt: Date
    let pages: Int
    let findings: Int
    let causes: Int
    let errors: Int
    let warnings: Int

    var filename: String { "\(id.uuidString).json" }

    var summary: String {
        "\(pages) pages · \(causes) thing\(causes == 1 ? "" : "s") to change"
    }
}

@MainActor
final class Library: ObservableObject {
    @Published private(set) var reports: [StoredReport] = []

    private let folder: URL
    private let indexFile: URL

    /// Application Support, because these are documents the app manages rather
    /// than preferences. Caches would be wrong: the system may delete those,
    /// and seven minutes of crawling is not a cache.
    init(root: URL? = nil) {
        let base = root ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("seo-audit", isDirectory: true)
        folder = base.appendingPathComponent("reports", isDirectory: true)
        indexFile = base.appendingPathComponent("index.json")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        load()
    }

    private func load() {
        guard let data = try? Data(contentsOf: indexFile) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        reports = ((try? decoder.decode([StoredReport].self, from: data)) ?? [])
            // An index entry whose file is gone is a row that opens onto
            // nothing, which is worse than not listing it.
            .filter { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0.filename).path) }
            .sorted { $0.finishedAt > $1.finishedAt }
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted]
        try? encoder.encode(reports).write(to: indexFile)
    }

    /// Store a finished run. `raw` is what the engine sent, byte for byte.
    @discardableResult
    func keep(_ report: Report, site: String, raw: Data, at now: Date = Date()) -> StoredReport {
        let counts = report.counts
        let stored = StoredReport(
            id: UUID(),
            host: URL(string: site)?.host ?? site,
            site: site,
            finishedAt: now,
            pages: report.meta.pages,
            findings: report.findings.count,
            causes: report.causes.count,
            errors: counts.error,
            warnings: counts.warn
        )
        try? raw.write(to: folder.appendingPathComponent(stored.filename))
        reports.insert(stored, at: 0)
        // A bound, because this is a list to click rather than an archive, and
        // a 325-page report is about 700 KB.
        if reports.count > 40 { reports.suffix(from: 40).forEach(deleteFile) ; reports = Array(reports.prefix(40)) }
        save()
        return stored
    }

    func reopen(_ stored: StoredReport) -> (Report, Data)? {
        guard let data = try? Data(contentsOf: folder.appendingPathComponent(stored.filename)),
              let report = try? JSONDecoder().decode(Report.self, from: data)
        else { return nil }
        return (report, data)
    }

    func forget(_ stored: StoredReport) {
        deleteFile(stored)
        reports.removeAll { $0.id == stored.id }
        save()
    }

    private func deleteFile(_ stored: StoredReport) {
        try? FileManager.default.removeItem(at: folder.appendingPathComponent(stored.filename))
    }
}
