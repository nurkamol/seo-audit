// Saving a report, in whatever shape somebody needs it.
//
// The app owns none of these formats. It holds the findings it was streamed and
// asks the engine to write them — the same `html()`, `markdown()` and `csv()`
// the CLI uses, so a report exported here and one written by
// `seo-audit --csv` are the same file.
//
// PDF is the exception, because the engine has no PDF writer and this app has
// no web view to print one with. It is drawn natively — but only *drawn*: the
// grouping, the areas and the scope lines all arrive from the engine, so it is
// a second rendering of one report rather than a second opinion about it.

import SwiftUI
import AppKit
import UniformTypeIdentifiers

enum ExportFormat: String, CaseIterable, Identifiable {
    case pdf, html, markdown, csv, json, sitemap, llms, schema

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pdf: "PDF"
        case .html: "HTML report"
        case .markdown: "Markdown"
        case .csv: "Spreadsheet (CSV)"
        case .json: "JSON"
        case .sitemap: "Sitemap (XML)"
        case .llms: "llms.txt"
        case .schema: "Structured data (JSON-LD)"
        }
    }

    var detail: String {
        switch self {
        case .pdf: "What is on screen, on paper. For sending to somebody."
        case .html: "The full report, one file, opens in any browser."
        case .markdown: "For committing, or pasting into a ticket."
        case .csv: "One row per finding. For sorting and filtering."
        case .json: "Everything, exactly as the engine produced it."
        case .sitemap: "The sitemap this site should have had."
        case .llms: "The llms.txt this site should have had, from its own words."
        case .schema: "The JSON-LD this site could add, from what it already says."
        }
    }

    var symbol: String {
        switch self {
        case .pdf: "doc.richtext"
        case .html: "safari"
        case .markdown: "text.alignleft"
        case .csv: "tablecells"
        case .json: "curlybraces"
        case .sitemap: "list.bullet.rectangle"
        case .llms: "sparkles"
        case .schema: "chevron.left.forwardslash.chevron.right"
        }
    }

    var type: UTType {
        switch self {
        case .pdf: .pdf
        case .html: .html
        case .markdown: UTType(filenameExtension: "md") ?? .plainText
        case .csv: .commaSeparatedText
        case .json: .json
        case .sitemap: UTType(filenameExtension: "xml") ?? .xml
        case .llms: .plainText
        case .schema: .json
        }
    }

    var fileExtension: String {
        switch self {
        case .pdf: "pdf"
        case .html: "html"
        case .markdown: "md"
        case .csv: "csv"
        case .json: "json"
        case .sitemap: "xml"
        case .llms: "txt"
        case .schema: "json"
        }
    }
}

@MainActor
enum Export {
    /// The engine writes every format except PDF, which is a drawing rather
    /// than a document the engine has.
    static func save(_ format: ExportFormat, report: Report, host: String, engine: URL?, raw: Data?) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "SEO Audit — \(host).\(format.fileExtension)"
        panel.allowedContentTypes = [format.type]
        panel.begin { response in
            guard response == .OK, let destination = panel.url else { return }
            switch format {
            case .pdf:
                PDF.write(report: report, host: host, to: destination)
            case .json:
                // Exactly what arrived, rather than this app's idea of it: a
                // re-encode would quietly drop any field the models do not know
                // about yet.
                try? (raw ?? Data()).write(to: destination)
            case .sitemap:
                // Already built by the engine and carried with the report; the
                // menu item is disabled when it refused, so this is never a
                // silent no-op.
                if let xml = report.sitemap?.xml { try? Data(xml.utf8).write(to: destination) }
            case .llms:
                if let text = report.llms?.text { try? Data(text.utf8).write(to: destination) }
            case .schema:
                if let json = report.schema?.json { try? Data(json.utf8).write(to: destination) }
            case .html, .markdown, .csv:
                Task { await render(format, report: report, raw: raw, engine: engine, to: destination) }
            }
        }
    }

    /// The report goes back to the engine as the bytes it arrived in.
    ///
    /// It used to be re-encoded from the decoded models, and that quietly
    /// dropped every field this app had not been taught about — the day the
    /// engine started scoring a run, an HTML report exported from this window
    /// lost the score panel the window itself was showing. The JSON export has
    /// written `raw` verbatim for exactly this reason since it shipped; this
    /// now does the same, and the encoders below are only the fallback for a
    /// report whose bytes are no longer to hand.
    private static func render(
        _ format: ExportFormat,
        report: Report,
        raw: Data?,
        engine: URL?,
        to destination: URL
    ) async {
        guard let engine else { return }
        var request = URLRequest(url: engine.appending(path: "render")
            .appending(queryItems: [.init(name: "as", value: format.rawValue)]))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = raw
            ?? (try? JSONEncoder().encode(RenderRequest(meta: report.meta, findings: report.findings)))

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return }
        try? data.write(to: destination)
    }

    /// The findings, going back the way they came. Only reached when the bytes
    /// the engine sent are not available.
    private struct RenderRequest: Encodable {
        let meta: Meta
        let findings: [Finding]
    }
}

extension Meta: Encodable {
    func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(origin, forKey: .origin)
        try box.encode(pages, forKey: .pages)
        try box.encodeIfPresent(requests, forKey: .requests)
        try box.encodeIfPresent(ms, forKey: .ms)
        try box.encodeIfPresent(date, forKey: .date)
        try box.encodeIfPresent(notIndexable, forKey: .notIndexable)
        try box.encodeIfPresent(ignored, forKey: .ignored)
    }

    enum CodingKeys: String, CodingKey {
        case origin, pages, requests, ms, date, notIndexable, ignored
    }
}

extension Finding: Encodable {
    func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(level.rawValue, forKey: .level)
        try box.encode(id, forKey: .id)
        try box.encode(title, forKey: .title)
        try box.encode(detail, forKey: .detail)
        try box.encodeIfPresent(url, forKey: .url)
        try box.encodeIfPresent(indexable, forKey: .indexable)
        try box.encodeIfPresent(reach, forKey: .reach)
        try box.encodeIfPresent(traffic, forKey: .traffic)
    }

    enum CodingKeys: String, CodingKey {
        case level, id, title, detail, url, indexable, reach, traffic
    }
}

extension Finding.Reach: Encodable {
    func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(inlinks, forKey: .inlinks)
        try box.encodeIfPresent(depth, forKey: .depth)
    }

    enum CodingKeys: String, CodingKey { case inlinks, depth }
}

extension Finding.Traffic: Encodable {
    func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(impressions, forKey: .impressions)
        try box.encode(clicks, forKey: .clicks)
    }

    enum CodingKeys: String, CodingKey { case impressions, clicks }
}
