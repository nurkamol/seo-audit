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
    case pdf, html, markdown, csv, json

    var id: String { rawValue }

    var label: String {
        switch self {
        case .pdf: "PDF"
        case .html: "HTML report"
        case .markdown: "Markdown"
        case .csv: "Spreadsheet (CSV)"
        case .json: "JSON"
        }
    }

    var detail: String {
        switch self {
        case .pdf: "What is on screen, on paper. For sending to somebody."
        case .html: "The full report, one file, opens in any browser."
        case .markdown: "For committing, or pasting into a ticket."
        case .csv: "One row per finding. For sorting and filtering."
        case .json: "Everything, exactly as the engine produced it."
        }
    }

    var symbol: String {
        switch self {
        case .pdf: "doc.richtext"
        case .html: "safari"
        case .markdown: "text.alignleft"
        case .csv: "tablecells"
        case .json: "curlybraces"
        }
    }

    var type: UTType {
        switch self {
        case .pdf: .pdf
        case .html: .html
        case .markdown: UTType(filenameExtension: "md") ?? .plainText
        case .csv: .commaSeparatedText
        case .json: .json
        }
    }

    var fileExtension: String {
        switch self {
        case .pdf: "pdf"
        case .html: "html"
        case .markdown: "md"
        case .csv: "csv"
        case .json: "json"
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
            case .html, .markdown, .csv:
                Task { await render(format, report: report, engine: engine, to: destination) }
            }
        }
    }

    private static func render(_ format: ExportFormat, report: Report, engine: URL?, to destination: URL) async {
        guard let engine else { return }
        var request = URLRequest(url: engine.appending(path: "render")
            .appending(queryItems: [.init(name: "as", value: format.rawValue)]))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(RenderRequest(meta: report.meta, findings: report.findings))

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return }
        try? data.write(to: destination)
    }

    /// The findings, going back the way they came. Encodable mirrors of the
    /// decoded models, because the engine wants the shape it sent.
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
