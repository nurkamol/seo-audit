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

    /// A cause's share of what its check is costing the score.
    ///
    /// A check can be a cause under two sections, and printing the whole
    /// check's cost against each would say the site can gain the same points
    /// twice. Split by pages, which is the only thing that divides it honestly
    /// — the same split `causeCost()` makes in `src/report.mjs`.
    private func gain(for cause: Cause) -> Double? {
        guard let check = report.score?.failed?.first(where: { $0.id == cause.id }) else { return nil }
        guard check.pages > 0 else { return check.cost }
        return check.cost * min(1, Double(cause.pages.count) / Double(check.pages))
    }

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
                                gain: gain(for: cause),
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

                        // What passed, and what never came up. A report that
                        // only lists faults gives no way to tell a check that
                        // passed from one that was never run, and a missing
                        // finding reads exactly like a passing one.
                        if let score = report.score, search.isEmpty, level == nil {
                            PassingSection(score: score)
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

    private var host: String { URL(string: site)?.host ?? site }

    /// Why a format the engine builds during the crawl has nothing to write.
    private func refusal(for format: ExportFormat) -> String? {
        switch format {
        case .sitemap: report.sitemap?.refused
        case .llms: report.llms?.refused
        case .schema: report.schema?.refused
        default: nil
        }
    }

    private func unavailable(_ format: ExportFormat) -> Bool {
        switch format {
        case .sitemap: report.sitemap?.xml == nil
        case .llms: report.llms?.text == nil
        case .schema: report.schema?.json == nil
        default: false
        }
    }

    /// One run in the Compare menu. Runs of another site carry their host,
    /// since the date alone would not say which site was picked.
    private func row(_ run: StoredReport, showHost: Bool) -> some View {
        Button {
            compare(run)
        } label: {
            Text(showHost
                 ? "\(run.host) · \(run.finishedAt.formatted(date: .abbreviated, time: .shortened))"
                 : run.finishedAt.formatted(date: .abbreviated, time: .shortened))
            Text(run.summary)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Button(action: back) { Label("New audit", systemImage: "chevron.left") }
                    .buttonStyle(.glass)
                Spacer(minLength: 0)
                // Two runs, and what moved. Beside Export because that is where
                // somebody is already looking when they have a report in front
                // of them and a previous one in mind.
                //
                // Runs of other sites are offered under their own heading: the
                // question people arrive with is usually "is the rebuild
                // better than the site it replaces", and the rebuild lives on
                // a different host. The engine compares those by path.
                Menu {
                    if earlierRuns.isEmpty {
                        Text("No other run is kept yet")
                    } else {
                        let mine = earlierRuns.filter { $0.host == host }
                        let others = earlierRuns.filter { $0.host != host }
                        if !mine.isEmpty {
                            Section("Earlier runs of \(host)") {
                                ForEach(mine) { run in row(run, showHost: false) }
                            }
                        }
                        if !others.isEmpty {
                            Section("Another site") {
                                ForEach(others) { run in row(run, showHost: true) }
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
                            // The two the engine can refuse say why they are
                            // unavailable rather than being absent or writing
                            // an empty file: the refusal is the useful half of
                            // that answer, and it names the run that would
                            // succeed.
                            Text(refusal(for: format) ?? format.detail)
                        }
                        .disabled(unavailable(format))
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
                // The score sits with the tallies rather than above them: it is
                // the same three numbers, weighed. Only drawn when the engine
                // sent one — a report kept before scoring existed, or a site
                // that never answered, has none, and an empty dial reading zero
                // would be a claim rather than a gap.
                if let score = report.score, let value = score.score {
                    ScoreDial(score: score, value: value)
                }
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

/// The score, as a ring.
///
/// A number and a length: 74 and 62 read the same at a glance and two arcs do
/// not. What it costs to be wrong is decided in `src/score.mjs` and never here.
private struct ScoreDial: View {
    let score: Score
    let value: Int

    private var tint: Color { value >= 80 ? .green : value >= 60 ? .orange : .red }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .stroke(.quaternary, lineWidth: 7)
                Circle()
                    .trim(from: 0, to: CGFloat(value) / 100)
                    .stroke(tint, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 0) {
                    Text("\(value)")
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .contentTransition(.numericText())
                    if let grade = score.grade {
                        Text(grade)
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(width: 58, height: 58)
            .animation(.spring(response: 0.6, dampingFraction: 0.85), value: value)

            VStack(alignment: .leading, spacing: 2) {
                Text("SCORE")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                if let checks = score.checks {
                    Text("\(checks.passed) passed")
                        .font(.callout.weight(.medium))
                    Text("\(checks.failed) to fix · \(checks.skipped) n/a")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .glassEffect(.regular, in: .rect(cornerRadius: Radius.card))
        .help(helpText)
    }

    private var helpText: String {
        var lines = ["An error-level check costs 12 points and a warning 4, spread across the pages "
                     + "it is on. Notes cost nothing, and a check that could not apply here is left "
                     + "out rather than counted as passed."]
        if let fixed = score.ifErrorsFixed, fixed > value {
            lines.append("Clear the errors alone and it is \(fixed).")
        }
        return lines.joined(separator: "\n\n")
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
    /// What the score gains when this piece of work is done, when the engine
    /// scored the check it belongs to. Notes have none, because they cost the
    /// score nothing.
    var gain: Double?
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
                    if let gain, gain >= 0.05 {
                        Text("+\(gain, specifier: "%.1f")")
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(.green)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(.green.opacity(0.14), in: .rect(cornerRadius: Radius.pill))
                            .help("What the score gains when this is clean")
                    }
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

// MARK: - What passed, and what was never checked

/// The other half of a report.
///
/// A check that passed and a check that never ran look identical from the
/// outside — both produce nothing — so both are named here, and the second says
/// why. Collapsed by default: on a report somebody opened to fix something,
/// eighty green lines above the work would be eighty lines in the way.
private struct PassingSection: View {
    let score: Score

    @State private var showingPassed = false
    @State private var showingSkipped = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let checks = score.checks, checks.passed > 0 {
                Panel(
                    open: $showingPassed,
                    symbol: "checkmark.seal.fill",
                    tint: AnyShapeStyle(.green),
                    title: "\(checks.passed) checks passed",
                    note: "Everything this site got right, in its own words."
                ) {
                    ForEach(score.passedByArea, id: \.name) { area, list in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(area.uppercased())
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(.tertiary)
                            ForEach(list) { check in
                                Label(check.pass, systemImage: "checkmark")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                                    .labelStyle(.titleAndIcon)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }

            if let checks = score.checks, checks.skipped > 0 {
                Panel(
                    open: $showingSkipped,
                    symbol: "minus.circle",
                    tint: AnyShapeStyle(.secondary),
                    title: "\(checks.skipped) checks did not apply",
                    note: "Counted neither for nor against the score."
                ) {
                    ForEach(score.skippedByReason, id: \.why) { why, ids in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(why).font(.callout)
                            Text(ids.joined(separator: ", "))
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.tertiary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    /// One collapsible card. The whole row is the hit target, not the chevron —
    /// a disclosure triangle is a four-point target on a full-width row.
    private struct Panel<Content: View>: View {
        @Binding var open: Bool
        let symbol: String
        let tint: AnyShapeStyle
        let title: String
        let note: String
        @ViewBuilder var content: () -> Content

        var body: some View {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: symbol).foregroundStyle(tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.system(.headline, design: .rounded))
                        Text(note).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(open ? 90 : 0))
                }
                .padding(16)
                .contentShape(.rect)
                .onTapGesture { withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) { open.toggle() } }

                if open {
                    VStack(alignment: .leading, spacing: 14) {
                        content()
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(.regular, in: .rect(cornerRadius: Radius.card))
        }
    }
}
