// The report, drawn here rather than displayed as a page.
//
// The engine decides what the findings are and which of them are one piece of
// work; this decides what that looks like. Sorting, filtering and searching are
// presentation, and presentation is the one thing a native app should own.

import SwiftUI
import AppKit

struct ReportView: View {
    let report: Report
    let site: String
    /// Other runs of this same site that are still on disk, newest first. Empty
    /// on the first audit of a site, which is when there is nothing to compare
    /// against and the menu says so rather than being missing.
    var earlierRuns: [StoredReport] = []
    var back: () -> Void
    var export: (ExportFormat) -> Void
    var compare: (StoredReport) -> Void = { _ in }
    var silence: (String) -> Void = { _ in }

    @State private var expanded: Set<String> = []
    @State private var search = ""
    @State private var level: Finding.Level?
    @Namespace private var cards

    private var causes: [Cause] {
        report.causes.filter { cause in
            (level == nil || cause.level == level!)
                && (search.isEmpty
                    || cause.title.localizedCaseInsensitiveContains(search)
                    || cause.section.localizedCaseInsensitiveContains(search)
                    || cause.id.localizedCaseInsensitiveContains(search))
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            Header(report: report, site: site, earlierRuns: earlierRuns,
                   back: back, export: export, compare: compare)

            Filters(search: $search, level: $level, counts: report.counts)
                .padding(.horizontal, 20)
                .padding(.bottom, 6)

            ScrollView {
                GlassEffectContainer(spacing: 14) {
                    LazyVStack(spacing: 12) {
                        // By identity: `id` is the check, and one check can be a
                        // cause under two sections — a repeated id in a ForEach
                        // expands the wrong card.
                        ForEach(causes, id: \.identity) { cause in
                            CauseCard(
                                cause: cause,
                                findings: report.findings(for: cause),
                                open: expanded.contains(cause.identity),
                                cards: cards,
                                silence: { silence(cause.id) }
                            ) {
                                withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) {
                                    if expanded.contains(cause.identity) {
                                        expanded.remove(cause.identity)
                                    } else {
                                        expanded.insert(cause.identity)
                                    }
                                }
                            }
                            .transition(.asymmetric(
                                insertion: .scale(scale: 0.97).combined(with: .opacity),
                                removal: .opacity
                            ))
                        }

                        if causes.isEmpty {
                            ContentUnavailableView(
                                search.isEmpty ? "Nothing at this level" : "No match",
                                systemImage: "checkmark.seal",
                                description: Text(search.isEmpty
                                    ? "Every finding here is something else."
                                    : "Nothing matches “\(search)”.")
                            )
                            .padding(.top, 40)
                        }
                    }
                    .padding(20)
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: causes)
        }
        // ⌘E from the menu bar, which cannot reach into this view otherwise.
        .onReceive(NotificationCenter.default.publisher(for: .exportReport)) { _ in export(.pdf) }
    }
}

private struct Header: View {
    let report: Report
    let site: String
    var earlierRuns: [StoredReport]
    var back: () -> Void
    var export: (ExportFormat) -> Void
    var compare: (StoredReport) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Button(action: back) { Label("New audit", systemImage: "chevron.left") }
                    .buttonStyle(.glass)
                Spacer(minLength: 0)
                // Two runs of one site, and what moved. Beside Export because
                // that is where somebody is already looking when they have a
                // report in front of them and a previous one in mind.
                Menu {
                    if earlierRuns.isEmpty {
                        Text("No earlier run of this site is kept yet")
                    } else {
                        ForEach(earlierRuns) { run in
                            Button {
                                compare(run)
                            } label: {
                                Text(run.finishedAt.formatted(date: .abbreviated, time: .shortened))
                                Text(run.summary)
                            }
                        }
                    }
                } label: {
                    Label("Compare", systemImage: "arrow.left.arrow.right")
                }
                .menuStyle(.button)
                .buttonStyle(.glass)
                .disabled(earlierRuns.isEmpty)
                .fixedSize()

                Menu {
                    // Every format the engine can write, plus the one drawing
                    // this app makes itself.
                    ForEach(ExportFormat.allCases) { format in
                        Button {
                            export(format)
                        } label: {
                            Label(format.label, systemImage: format.symbol)
                            // The sitemap says why it is unavailable rather
                            // than being absent or writing an empty file: the
                            // refusal is the useful half of that answer.
                            Text(format == .sitemap
                                 ? (report.sitemap?.refused ?? format.detail)
                                 : format.detail)
                        }
                        .disabled(format == .sitemap && report.sitemap?.xml == nil)
                    }
                } label: {
                    Label("Export", systemImage: "square.and.arrow.down")
                }
                .menuStyle(.button)
                .buttonStyle(.glass)
                .fixedSize()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(URL(string: site)?.host ?? site)
                    .font(.system(size: 26, weight: .semibold, design: .rounded))
                Text(summary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }

            HStack(spacing: 10) {
                Tally(count: report.counts.error, label: "Errors", tint: .red)
                Tally(count: report.counts.warn, label: "Warnings", tint: .orange)
                Tally(count: report.counts.info, label: "Notes", tint: .blue)
            }
        }
        .padding(20)
    }

    private var summary: String {
        let n = report.findings.count
        let c = report.causes.count
        var line = "\(report.meta.pages) pages · \(n) findings · \(c) thing\(c == 1 ? "" : "s") to change"
        // Never omitted. A check somebody silenced must not read the same as a
        // check that passed, which is the whole reason this number exists.
        if let silenced = report.meta.ignored, silenced > 0 {
            line += " · \(silenced) silenced"
        }
        return line
    }
}

private struct Tally: View {
    let count: Int
    let label: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(count)")
                .font(.system(size: 24, weight: .semibold, design: .rounded))
                .foregroundStyle(count == 0 ? AnyShapeStyle(.tertiary) : AnyShapeStyle(tint))
                .contentTransition(.numericText())
            Text(label.uppercased())
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .glassEffect(.regular, in: .rect(cornerRadius: Radius.card))
    }
}

private struct Filters: View {
    @Binding var search: String
    @Binding var level: Finding.Level?
    let counts: (error: Int, warn: Int, info: Int)

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Filter", text: $search)
                    .textFieldStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .glassEffect(.regular, in: .capsule)
            .frame(maxWidth: 260)

            ForEach(Finding.Level.allCases, id: \.self) { each in
                Button {
                    withAnimation(.snappy) { level = level == each ? nil : each }
                } label: {
                    Text(each.label)
                        .font(.callout)
                        .padding(.horizontal, 4)
                }
                .buttonStyle(.glass)
                .tint(level == each ? .accentColor : nil)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct CauseCard: View {
    let cause: Cause
    let findings: [Finding]
    let open: Bool
    var cards: Namespace.ID
    // Before `toggle`, so the trailing closure at the call site is still the
    // one that opens the card.
    var silence: () -> Void = {}
    var toggle: () -> Void

    /// The detail, when every page in this group carries the same one. `nil`
    /// when they differ, and then each page shows its own.
    private var shared: String? {
        guard let first = findings.first?.detail else { return nil }
        return findings.allSatisfy { $0.detail == first } ? first : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Pill(level: cause.level)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(cause.title)
                            .font(.system(.headline, design: .rounded))
                            .multilineTextAlignment(.leading)
                        Text(cause.scope)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .padding(16)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            if open {
                VStack(alignment: .leading, spacing: 10) {
                    // Only when it really is the group's detail. This used to
                    // print the first finding's line above every page, so a
                    // check whose detail carries a number — "267 chars (limit
                    // ~160)" — presented one page's number as the group's.
                    if let shared {
                        Text(shared)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                    }
                    Divider().opacity(0.4)
                    ForEach(findings.prefix(50)) { finding in
                        PageRow(finding: finding, detail: shared == nil ? finding.detail : nil)
                    }
                    if findings.count > 50 {
                        Text("and \(findings.count - 50) more")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .glassEffect(.regular, in: .rect(cornerRadius: Radius.card))
        .glassEffectID(cause.identity, in: cards)
        // Where somebody decides they can live with a check: on the finding
        // itself, at the moment they are looking at it and disagreeing with it.
        // A list buried in Settings is where you go to undo this, not to do it.
        .contextMenu {
            Button {
                silence()
            } label: {
                Label("Silence \(cause.id)", systemImage: "bell.slash")
                Text("Leaves it out of future runs on this machine. Reports still say how many "
                     + "findings were silenced.")
            }
        }
    }
}

private struct PageRow: View {
    let finding: Finding
    /// This page's own detail, when it differs from the rest of the group.
    var detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 8) {
            Text(path)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
            if finding.indexable == false {
                Text("not indexable")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer(minLength: 0)
            if let traffic = finding.traffic {
                Label("\(traffic.impressions)", systemImage: "eye")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else if let reach = finding.reach, reach.inlinks > 0 {
                Label("\(reach.inlinks)", systemImage: "link")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            if let url = finding.url, let link = URL(string: url) {
                Link(destination: link) { Image(systemName: "arrow.up.right") }
                    .font(.caption2)
                    .buttonStyle(.plain)
            }
        }
        if let detail {
            Text(detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        }
        .contextMenu {
            if let url = finding.url {
                Button("Copy URL") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(url, forType: .string)
                }
                Button("Open in browser") {
                    if let link = URL(string: url) { NSWorkspace.shared.open(link) }
                }
            }
        }
    }

    private var path: String {
        guard let url = finding.url, let parsed = URL(string: url) else { return finding.url ?? "" }
        return parsed.path.isEmpty ? "/" : parsed.path
    }
}

struct Pill: View {
    let level: Finding.Level

    var body: some View {
        Text(level.label.uppercased())
            .font(.system(size: 9, weight: .semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .foregroundStyle(tint)
            .background(tint.opacity(0.14), in: .rect(cornerRadius: Radius.pill))
            .overlay(RoundedRectangle(cornerRadius: Radius.pill).stroke(tint.opacity(0.35), lineWidth: 1))
    }

    private var tint: Color {
        switch level {
        case .error: .red
        case .warn: .orange
        case .info: .blue
        }
    }
}
