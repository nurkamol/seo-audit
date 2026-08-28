// The report as a PDF.
//
// It carries what the HTML report carries — the meta line, the counts, the work
// grouped by the area that fixes it, and under each piece of work the pages it
// affects with the detail that was written about each one. An export that shows
// less than the report it was exported from is a worse lie than no export: it
// looks complete.
//
// Drawn natively rather than by printing the engine's HTML, because there is no
// web view in this app and adding one to make a PDF would be a large thing to
// carry for a small feature. The grouping still comes from the engine — `area`
// arrives on every cause — so this is a second *drawing*, never a second set of
// decisions about what the findings mean.

import SwiftUI
import AppKit

enum PDF {
    private static let pageWidth: CGFloat = 595   // A4 at 72dpi
    private static let pageHeight: CGFloat = 842
    private static let margin: CGFloat = 44

    @MainActor
    static func write(report: Report, host: String, to url: URL) {
        var box = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
        guard let consumer = CGDataConsumer(url: url as CFURL),
              let context = CGContext(consumer: consumer, mediaBox: &box, nil)
        else { return }

        let content = pageWidth - margin * 2
        let usable = pageHeight - margin * 2

        // Measure every block, then pack them into pages. The previous version
        // emitted one page as tall as the whole report — fine for the two-
        // finding site it was tried on, a single unreadable strip for anything
        // real.
        let measured = blocks(report: report, host: host).map { block -> (AnyView, CGFloat) in
            (block, height(of: block, width: content))
        }

        var pages: [[AnyView]] = []
        var current: [AnyView] = []
        var used: CGFloat = 0
        for (block, blockHeight) in measured {
            // A block taller than a page goes on one of its own and is allowed
            // to overflow rather than being dropped.
            if !current.isEmpty, used + blockHeight > usable {
                pages.append(current)
                current = []
                used = 0
            }
            current.append(block)
            used += blockHeight
        }
        if !current.isEmpty { pages.append(current) }

        for (number, page) in pages.enumerated() {
            let sheet = Page(blocks: page, number: number + 1, of: pages.count)
                .frame(width: pageWidth, height: pageHeight)
            let renderer = ImageRenderer(content: sheet)
            renderer.render { _, draw in
                context.beginPDFPage(nil)
                draw(context)
                context.endPDFPage()
            }
        }
        context.closePDF()
    }

    @MainActor
    private static func height(of view: AnyView, width: CGFloat) -> CGFloat {
        let renderer = ImageRenderer(content: view.frame(width: width))
        var measured: CGFloat = 0
        renderer.render { size, _ in measured = size.height }
        return measured
    }

    /// The report as a flat list of things that must not be split across a page
    /// break: the header, then each area's heading, then each piece of work with
    /// its pages.
    @MainActor
    private static func blocks(report: Report, host: String) -> [AnyView] {
        var out: [AnyView] = [AnyView(Header(report: report, host: host))]
        for area in report.byArea {
            out.append(AnyView(AreaHeading(name: area.name, count: area.causes.count)))
            for cause in area.causes {
                out.append(AnyView(CauseBlock(
                    cause: cause,
                    findings: report.findings(for: cause),
                    gain: gain(for: cause, in: report)
                )))
            }
        }
        // What passed, and what never came up. An export that shows less than
        // the report it came from is a worse lie than no export, and until this
        // was here a PDF sent to a client listed only faults — with no way to
        // tell a check that passed from one that was never run.
        if let score = report.score, score.checks?.passed ?? 0 > 0 {
            out.append(AnyView(AreaHeading(name: "Passing", count: score.checks?.passed ?? 0)))
            for (area, checks) in score.passedByArea {
                out.append(AnyView(PassBlock(area: area, lines: checks.map(\.pass))))
            }
        }
        if let score = report.score, score.checks?.skipped ?? 0 > 0 {
            out.append(AnyView(AreaHeading(name: "Not checked", count: score.checks?.skipped ?? 0)))
            for (why, ids) in score.skippedByReason {
                out.append(AnyView(PassBlock(area: why, lines: [ids.joined(separator: ", ")], muted: true)))
            }
        }
        return out
    }

    /// A cause's share of what its check is costing the score — the same split
    /// `causeCost()` makes in `src/report.mjs`, because a check that is a cause
    /// under two sections must not claim the same points twice.
    private static func gain(for cause: Cause, in report: Report) -> Double? {
        guard let check = report.score?.failed?.first(where: { $0.id == cause.id }) else { return nil }
        guard check.pages > 0 else { return check.cost }
        return check.cost * min(1, Double(cause.pages.count) / Double(check.pages))
    }
}

// MARK: - Paper

/// White, light, and without the glass — paper has none of it.
private struct Page: View {
    let blocks: [AnyView]
    let number: Int
    let of: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(blocks.indices, id: \.self) { blocks[$0] }
            Spacer(minLength: 0)
            HStack {
                Text("seo-audit").font(.system(size: 7))
                Spacer()
                Text("\(number) of \(of)").font(.system(size: 7))
            }
            .foregroundStyle(.tertiary)
            .padding(.top, 10)
        }
        .padding(44)
        .frame(width: 595, height: 842, alignment: .topLeading)
        .background(.white)
        .environment(\.colorScheme, .light)
    }
}

private struct Header: View {
    let report: Report
    let host: String

    /// The same line the HTML report opens with, from the same numbers.
    private var meta: String {
        var parts = ["\(report.meta.pages) pages crawled"]
        if let requests = report.meta.requests { parts.append("\(requests) requests") }
        if let ms = report.meta.ms { parts.append(String(format: "%.1fs elapsed", Double(ms) / 1000)) }
        if let date = report.meta.date { parts.append(date) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(URL(string: host)?.host ?? host)
                    .font(.system(size: 21, weight: .semibold))
                Text(report.meta.origin).font(.system(size: 9)).foregroundStyle(.secondary)
                Text(meta).font(.system(size: 9)).foregroundStyle(.secondary)
            }

            HStack(spacing: 22) {
                if let value = report.score?.score {
                    Tally(number: value, label: "Score / 100\(report.score?.grade.map { "  ·  \($0)" } ?? "")")
                }
                Tally(number: report.counts.error, label: "Errors")
                Tally(number: report.counts.warn, label: "Warnings")
                Tally(number: report.counts.info, label: "Notes")
                Tally(number: report.causes.count, label: "Things to change")
            }

            if let score = report.score, let value = score.score {
                // The bar in characters, since ImageRenderer draws this and a
                // shape here would have to be measured like everything else.
                Text(bar(value))
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(.secondary)
                Text(scoreNote(score, value))
                    .font(.system(size: 8.5))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("\(report.findings.count) findings are \(report.causes.count) things to change, "
                 + "worst first and then by how much of the site points at them.")
                .font(.system(size: 8.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 16)
    }
}

private struct Tally: View {
    let number: Int
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("\(number)").font(.system(size: 17, weight: .semibold))
            Text(label).font(.system(size: 7.5)).foregroundStyle(.secondary)
        }
    }
}

private struct AreaHeading: View {
    let name: String
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Divider()
            HStack(spacing: 6) {
                Text(name).font(.system(size: 12, weight: .semibold))
                Text("\(count)").font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
        .padding(.top, 12)
        .padding(.bottom, 6)
    }
}

/// One piece of work: what it is, how far it reaches, the check that found it,
/// and every page it happened on with what was written about that page.
private struct CauseBlock: View {
    let cause: Cause
    let findings: [Finding]
    /// What the score gains when this is clean. Absent for a note, which costs
    /// the score nothing and therefore returns nothing.
    var gain: Double?

    /// Twenty-five pages is enough to see the shape of it. What is left out is
    /// counted rather than dropped quietly — a truncated list that does not say
    /// so reads exactly like a complete one.
    private var shown: ArraySlice<Finding> { findings.prefix(25) }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(cause.level.label.uppercased())
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 46, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text(cause.title).font(.system(size: 11.5, weight: .medium))
                    HStack(spacing: 6) {
                        Text(cause.scope).font(.system(size: 8.5)).foregroundStyle(.secondary)
                        Text(cause.id)
                            .font(.system(size: 8, design: .monospaced))
                            .foregroundStyle(.tertiary)
                        if let gain, gain >= 0.05 {
                            Text("+\(gain, specifier: "%.1f") to the score")
                                .font(.system(size: 8, weight: .medium))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(shown.enumerated()), id: \.offset) { _, finding in
                    VStack(alignment: .leading, spacing: 1) {
                        if let url = finding.url {
                            Text(url)
                                .font(.system(size: 8, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        Text(finding.detail)
                            .font(.system(size: 8.5))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if findings.count > shown.count {
                    Text("+ \(findings.count - shown.count) more page(s), in the HTML, CSV and JSON exports")
                        .font(.system(size: 8))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.leading, 54)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 6)
    }
}

/// A run of lines under one heading — the checks that passed in an area, or the
/// checks one reason accounts for. Plain text on paper: a tick column would be
/// a graphic to measure for no gain at 8.5pt.
private struct PassBlock: View {
    let area: String
    let lines: [String]
    var muted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(area.uppercased())
                .font(.system(size: 7, weight: .bold))
                .foregroundStyle(.secondary)
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(.system(size: muted ? 8 : 8.5, design: muted ? .monospaced : .default))
                    .foregroundStyle(muted ? .tertiary : .secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.bottom, 8)
    }
}

/// The score bar, in characters. The same twenty-eight cells the terminal draws.
private func bar(_ value: Int) -> String {
    let width = 28
    let filled = Int((Double(value) / 100 * Double(width)).rounded())
    return String(repeating: "█", count: filled) + String(repeating: "░", count: width - filled)
}

/// The arithmetic, said once, in the words the terminal and the HTML use.
private func scoreNote(_ score: Score, _ value: Int) -> String {
    var line = ""
    if let checks = score.checks {
        line = "\(score.lost.map { String(format: "%.1f", $0) } ?? "0") points across "
             + "\(checks.failed) check\(checks.failed == 1 ? "" : "s") · \(checks.passed) passed · "
             + "\(checks.skipped) did not apply. "
    }
    if let fixed = score.ifErrorsFixed, fixed > value {
        line += "Clear the errors alone and it is \(fixed). "
    }
    return line + "An error-level check costs 12 points and a warning 4, spread across the pages it is "
        + "on. Notes cost nothing, and a check that could not apply here is left out rather than "
        + "counted as passed."
}
