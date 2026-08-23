// ⌘, — laid out the way macOS lays out System Settings.
//
// It was one form, and it grew to seven sections and about two thousand points
// of height. Everything was reachable and nothing was findable: the sitemap
// field was below the fold on any laptop, and a scrollbar is a poor table of
// contents. A sidebar of named panes is what the platform does with the same
// problem, and it is what people already know how to use.
//
// Every pane is one subject, and no pane scrolls unless it has a list in it.

import SwiftUI
import AppKit

struct SettingsScene: View {
    @ObservedObject var settings: CrawlSettings
    @EnvironmentObject private var engine: Engine
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var updates: Updates

    @State private var pane: Pane? = .crawl

    /// The panes, in the order somebody meets them: what a run does, then what
    /// it did, then the app itself.
    enum Pane: String, CaseIterable, Identifiable {
        case crawl, coverage, identity, performance, silenced, reports, updates

        var id: String { rawValue }

        var title: String {
            switch self {
            case .crawl: "Crawl"
            case .coverage: "Coverage"
            case .identity: "Identify as"
            case .performance: "Performance"
            case .silenced: "Silenced"
            case .reports: "Reports"
            case .updates: "Updates"
            }
        }

        var symbol: String {
            switch self {
            case .crawl: "gauge.with.dots.needle.33percent"
            case .coverage: "square.grid.3x3"
            case .identity: "person.crop.square"
            case .performance: "speedometer"
            case .silenced: "bell.slash"
            case .reports: "tray.full"
            case .updates: "arrow.down.circle"
            }
        }

        /// The colour is not decoration: it is what makes a row findable at a
        /// glance in a list of seven, which is the whole point of the sidebar.
        var tint: Color {
            switch self {
            case .crawl: .orange
            case .coverage: .blue
            case .identity: .purple
            case .performance: .green
            case .silenced: .gray
            case .reports: .teal
            case .updates: .indigo
            }
        }

        var blurb: String {
            switch self {
            case .crawl: "How hard to crawl, and how much of the site to read."
            case .coverage: "How many pages, and what else to follow."
            case .identity: "Who the crawler says it is."
            case .performance: "Measured by Google, never estimated here."
            case .silenced: "Checks you have decided you can live with."
            case .reports: "Every finished run, kept on this machine."
            case .updates: "New versions, and how to move between them."
            }
        }
    }

    var body: some View {
        NavigationSplitView {
            List(Pane.allCases, selection: $pane) { pane in
                NavigationLink(value: pane) {
                    Label {
                        Text(pane.title)
                    } icon: {
                        PaneIcon(symbol: pane.symbol, tint: pane.tint)
                    }
                }
            }
            .navigationSplitViewColumnWidth(196)
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Header(pane: pane ?? .crawl)
                    body(of: pane ?? .crawl)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(22)
            }
        }
        .frame(width: 760, height: 520)
    }

    @ViewBuilder
    private func body(of pane: Pane) -> some View {
        switch pane {
        case .crawl: CrawlPane(settings: settings)
        case .coverage: CoveragePane(settings: settings)
        case .identity: IdentityPane(settings: settings, engine: engine)
        case .performance: PerformancePane(settings: settings)
        case .silenced: SilencedPane(settings: settings)
        case .reports: ReportsPane(library: library)
        case .updates: UpdatesPane(updates: updates)
        }
    }

    private struct Header: View {
        let pane: Pane

        var body: some View {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    PaneIcon(symbol: pane.symbol, tint: pane.tint, size: 26)
                    Text(pane.title).font(.system(.title2, design: .rounded).weight(.semibold))
                }
                Text(pane.blurb).font(.callout).foregroundStyle(.secondary)
                Divider().padding(.top, 4)
            }
            .padding(.bottom, 18)
        }
    }
}

/// The rounded square macOS puts a symbol in, at the two sizes this uses.
private struct PaneIcon: View {
    let symbol: String
    let tint: Color
    var size: CGFloat = 18

    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
            .fill(tint.gradient)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.55, weight: .semibold))
                    .foregroundStyle(.white)
            }
    }
}

// MARK: - The panes

/// A row of controls with the sentence that explains them underneath, which is
/// the shape every pane here is made of.
private struct Setting<Control: View>: View {
    let title: String
    let note: String
    @ViewBuilder var control: () -> Control

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent(title) { control() }
            Text(note)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 18)
    }
}

private struct CrawlPane: View {
    @ObservedObject var settings: CrawlSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Setting(title: "Speed", note: settings.speed.detail) {
                Picker("", selection: $settings.speed) {
                    ForEach(CrawlSettings.Speed.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 260)
            }

            Setting(title: "Sitemap",
                    note: "Only used when a sitemap is somewhere the usual names do not find it. "
                        + "It has to be on the site being audited.") {
                TextField("Sitemap URL", text: $settings.sitemap, prompt: Text("Found automatically"))
                    .textFieldStyle(.roundedBorder)
                    .labelsHidden()
                    .frame(width: 300)
            }
        }
    }
}

private struct CoveragePane: View {
    @ObservedObject var settings: CrawlSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Setting(title: "Pages per run",
                    note: "A crawl that stops at its limit says so in the report, with the number "
                        + "it did not reach.") {
                HStack(spacing: 6) {
                    Text("\(settings.limit)").monospacedDigit()
                    Stepper("Pages per run", value: $settings.limit, in: 1...5000, step: 50)
                        .labelsHidden()
                }
            }

            Setting(title: "Outbound links",
                    note: "Follows links to other sites to see whether they still resolve. Slower, "
                        + "and only a 404, 410 or no answer is reported.") {
                Toggle("", isOn: $settings.checkExternal).labelsHidden()
            }
        }
    }
}

private struct IdentityPane: View {
    @ObservedObject var settings: CrawlSettings
    @ObservedObject var engine: Engine

    private var overridden: Bool {
        !settings.userAgent.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Setting(title: "Browser",
                    note: "Some sites answer a crawler differently from a browser.") {
                Picker("", selection: $settings.browser) {
                    Text("This machine").tag("")
                    ForEach(settings.browsers, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
                .frame(width: 200)
                .disabled(overridden)
            }

            Setting(title: "System",
                    note: "A combination that cannot exist — Safari on Windows — is refused by the "
                        + "engine, and the run goes ahead as itself.") {
                Picker("", selection: $settings.system) {
                    Text("This machine").tag("")
                    ForEach(settings.systems, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
                .frame(width: 200)
                .disabled(overridden)
            }

            Setting(title: "Or your own",
                    note: overridden
                        ? "In use. The two menus above are ignored while this is set."
                        : "For an agent a host is known to treat differently, or a name of your own "
                          + "so your crawls are identifiable in somebody's logs.") {
                TextField("User agent", text: $settings.userAgent, prompt: Text("A string of your own"))
                    .textFieldStyle(.roundedBorder)
                    .labelsHidden()
                    .frame(width: 300)
            }
        }
        .task { await settings.loadAgents(from: engine.base) }
    }
}

private struct PerformancePane: View {
    @ObservedObject var settings: CrawlSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Setting(title: "Measure",
                    note: "Google measures it, over its own network, in a real browser. This app "
                        + "never estimates performance — a plausible wrong number is worse than no "
                        + "number. Each page takes a few seconds, which is why it is sampled.") {
                Picker("", selection: $settings.performance) {
                    ForEach(CrawlSettings.Performance.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 260)
            }

            if settings.performance == .sample {
                Setting(title: "Pages", note: "Spread across the site, not the first few.") {
                    HStack(spacing: 6) {
                        Text("\(settings.performanceSample)").monospacedDigit()
                        Stepper("Pages", value: $settings.performanceSample, in: 1...10)
                            .labelsHidden()
                    }
                }
            }

            if settings.performance != .off {
                Setting(title: "As a desktop browser",
                        note: "Mobile otherwise, which is what Google indexes with.") {
                    Toggle("", isOn: $settings.performanceOnDesktop).labelsHidden()
                }
            }

            Label("A PageSpeed API key is optional and raises the quota. The engine reads "
                  + "PSI_API_KEY, or ~/.config/seo-audit/.env — the same two places the command "
                  + "line looks, so a key already set is already working. This app never holds one.",
                  systemImage: "key")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct SilencedPane: View {
    @ObservedObject var settings: CrawlSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if settings.ignored.isEmpty {
                ContentUnavailableView("Nothing is silenced",
                                       systemImage: "bell",
                                       description: Text("Right-click a finding in a report to leave "
                                                         + "its check out of future runs."))
                    .frame(height: 190)
            } else {
                ForEach(settings.ignored, id: \.self) { id in
                    HStack {
                        Text(id).font(.system(.callout, design: .monospaced))
                        Spacer(minLength: 0)
                        Button("Stop silencing") { withAnimation(.snappy) { settings.unsilence(id) } }
                            .controlSize(.small)
                    }
                    Divider()
                }
                Text("A report still says how many findings were silenced. A check somebody "
                     + "quietened must never read the same as one that passed.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text("Per-machine on purpose. A decision a whole team shares belongs in the config file "
                 + "the repository commits, where everybody's runs read it.")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct ReportsPane: View {
    @ObservedObject var library: Library
    @State private var confirming = false

    private var size: String {
        ByteCountFormatter.string(fromByteCount: Int64(library.bytesOnDisk), countStyle: .file)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Setting(title: "Kept",
                    note: "Every finished run is written as the exact JSON the engine produced, so "
                        + "a report saved by one version still opens in the next — and `jq` works "
                        + "on it. The forty most recent are kept.") {
                Text(library.reports.isEmpty
                     ? "None yet"
                     : "\(library.reports.count) report\(library.reports.count == 1 ? "" : "s") · \(size)")
                    .foregroundStyle(.secondary)
            }

            Setting(title: "Location",
                    note: library.location.path(percentEncoded: false)) {
                Button("Reveal in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting([library.location])
                }
            }

            Setting(title: "Delete all",
                    note: "Removes every kept report from this machine. The sites are not touched, "
                        + "and nothing is sent anywhere — these files never left it.") {
                Button("Delete…", role: .destructive) { confirming = true }
                    .disabled(library.reports.isEmpty)
            }
        }
        .confirmationDialog("Delete every kept report?", isPresented: $confirming) {
            Button("Delete \(library.reports.count) report\(library.reports.count == 1 ? "" : "s")",
                   role: .destructive) {
                withAnimation(.snappy) { library.forgetAll() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("A seven-minute crawl is not quick to repeat. This cannot be undone.")
        }
    }
}

private struct UpdatesPane: View {
    @ObservedObject var updates: Updates

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Setting(title: "Version",
                    note: updates.available == nil
                        ? "This is the newest release this app knows about."
                        : "A newer release is out. Open Versions from the sidebar to read what "
                          + "changed and move to it.") {
                Text(updates.current.description)
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            Setting(title: "Check automatically",
                    note: "Once a day at most. Off is a real preference: it is one request to "
                        + "GitHub about which software you run.") {
                Toggle("", isOn: Binding(get: { updates.automatic },
                                         set: { updates.automatic = $0 })).labelsHidden()
            }

            Setting(title: "Last checked",
                    note: "The list is kept, so the Versions sheet is never empty after one "
                        + "successful check — GitHub refusing an hour later is not a reason to "
                        + "forget what it said.") {
                HStack(spacing: 10) {
                    Text(updates.lastChecked.map {
                        $0.formatted(date: .abbreviated, time: .shortened)
                    } ?? "Never")
                        .foregroundStyle(.secondary)
                    Button("Check now") { Task { await updates.check() } }
                        .disabled(updates.checking)
                    if updates.checking { ProgressView().controlSize(.small) }
                }
            }

            if let problem = updates.problem {
                Label(problem, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
