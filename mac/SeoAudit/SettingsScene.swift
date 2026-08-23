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

    private var showing: Pane { pane ?? .crawl }

    var body: some View {
        NavigationSplitView {
            List(Pane.allCases, selection: $pane) { pane in
                NavigationLink(value: pane) {
                    Label {
                        Text(pane.title)
                    } icon: {
                        PaneIcon(symbol: pane.symbol, tint: pane.tint)
                    }
                    .padding(.vertical, 2)
                }
            }
            .navigationSplitViewColumnWidth(198)
            // On the sidebar's own content, which is where it takes. Applied to
            // the split view it did nothing, and the button stayed — in a
            // Settings window, where the sidebar is the only route to six of
            // the seven panes and collapsing it is never what somebody wants.
            .toolbar(removing: .sidebarToggle)
        } detail: {
            // One Form for the whole pane, header included. Two stacked views
            // each carrying their own insets left an empty band the height of a
            // toolbar between the title bar and the first control.
            Form {
                Section {
                    HStack(alignment: .top, spacing: 14) {
                        PaneIcon(symbol: showing.symbol, tint: showing.tint, size: 38)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(showing.title)
                                .font(.system(.title3, design: .rounded).weight(.semibold))
                            Text(showing.blurb)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    // Left, like every row beneath it. Centred, the icon and
                    // title lined up with nothing else in the pane, and the
                    // first thing the eye does in a settings window is run down
                    // the left edge.
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 6)
                }

                body(of: showing)
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
        }
        .frame(width: 740, height: 540)
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
}

/// The rounded square macOS puts a symbol in, at the two sizes this uses.
private struct PaneIcon: View {
    let symbol: String
    let tint: Color
    var size: CGFloat = 20

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
//
// Each is a `Form` with `Section`s: the label column, the control column and
// the explanation underneath all come from the platform, which is why they line
// up with each other and with every other settings window on the machine.

private struct CrawlPane: View {
    @ObservedObject var settings: CrawlSettings

    var body: some View {
        Group {
            Section {
                Picker("Speed", selection: $settings.speed) {
                    ForEach(CrawlSettings.Speed.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
            } footer: {
                Text(settings.speed.detail).footnote()
            }

            Section {
                // `.roundedBorder`, or a grouped Form draws this as right-aligned
                // grey text with no box — indistinguishable from a read-only
                // value. "Sitemap · Found automatically" then reads as a fact
                // about the site rather than as an empty field you can type in.
                TextField("Sitemap", text: $settings.sitemap, prompt: Text("Found automatically"))
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 260)
            } footer: {
                Text("Only used when a sitemap is somewhere the usual names do not find it. It has "
                     + "to be on the site being audited.").footnote()
            }
        }
    }
}

private struct CoveragePane: View {
    @ObservedObject var settings: CrawlSettings

    var body: some View {
        Group {
            Section {
                Stepper(value: $settings.limit, in: 1...5000, step: 50) {
                    LabeledContent("Pages per run") {
                        Text("\(settings.limit)").monospacedDigit()
                    }
                }
            } footer: {
                Text("A crawl that stops at its limit says so in the report, with the number it did "
                     + "not reach.").footnote()
            }

            Section {
                Toggle("Check outbound links", isOn: $settings.checkExternal)
            } footer: {
                Text("Follows links to other sites to see whether they still resolve. Slower, and "
                     + "only a 404, 410 or no answer is reported.").footnote()
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
        Group {
            Section {
                Picker("Browser", selection: $settings.browser) {
                    Text("This machine").tag("")
                    ForEach(settings.browsers, id: \.self) { Text($0).tag($0) }
                }
                Picker("System", selection: $settings.system) {
                    Text("This machine").tag("")
                    ForEach(settings.systems, id: \.self) { Text($0).tag($0) }
                }
            } footer: {
                Text("Some sites answer a crawler differently from a browser. A combination that "
                     + "cannot exist — Safari on Windows — is refused by the engine, and the run "
                     + "goes ahead as itself.").footnote()
            }
            // Greyed rather than silently losing: the engine ignores both menus
            // when a string of your own is set, and a control that does nothing
            // should look like one.
            .disabled(overridden)

            Section {
                TextField("Or your own", text: $settings.userAgent,
                          prompt: Text("A string of your own"))
                    .textFieldStyle(.roundedBorder)
                    .frame(maxWidth: 260)
            } footer: {
                Text(overridden
                     ? "In use. The two menus above are ignored while this is set."
                     : "For an agent a host is known to treat differently, or a name of your own so "
                       + "your crawls are identifiable in somebody's logs.").footnote()
            }
        }
        .task { await settings.loadAgents(from: engine.base) }
    }
}

private struct PerformancePane: View {
    @ObservedObject var settings: CrawlSettings

    var body: some View {
        Group {
            Section {
                Picker("Measure", selection: $settings.performance) {
                    ForEach(CrawlSettings.Performance.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)

                if settings.performance == .sample {
                    Stepper(value: $settings.performanceSample, in: 1...10) {
                        LabeledContent("Pages") {
                            Text("\(settings.performanceSample)").monospacedDigit()
                        }
                    }
                }
                if settings.performance != .off {
                    Toggle("Measure as a desktop browser", isOn: $settings.performanceOnDesktop)
                }
            } footer: {
                Text("Google measures it, over its own network, in a real browser. This app never "
                     + "estimates performance — a plausible wrong number is worse than no number. "
                     + "Each page takes a few seconds, which is why it is sampled.").footnote()
            }

            Section {
                Label("A PageSpeed API key is optional and raises the quota. The engine reads "
                      + "PSI_API_KEY, or ~/.config/seo-audit/.env — the same two places the command "
                      + "line looks, so a key already set is already working. This app never holds "
                      + "one.", systemImage: "key")
                    .footnote()
            }
        }
    }
}

private struct SilencedPane: View {
    @ObservedObject var settings: CrawlSettings

    var body: some View {
        Group {
            if settings.ignored.isEmpty {
                Section {
                    Text("Nothing is silenced. Right-click a finding in a report to leave its check "
                         + "out of future runs on this machine.")
                        .footnote()
                }
            } else {
                Section {
                    ForEach(settings.ignored, id: \.self) { id in
                        LabeledContent {
                            Button("Stop silencing") {
                                withAnimation(.snappy) { settings.unsilence(id) }
                            }
                        } label: {
                            Text(id).font(.system(.body, design: .monospaced))
                        }
                    }
                } footer: {
                    Text("A report still says how many findings were silenced. A check somebody "
                         + "quietened must never read the same as one that passed.").footnote()
                }
            }

            Section {
                Text("Per-machine on purpose. A decision a whole team shares belongs in the config "
                     + "file the repository commits, where everybody's runs read it.")
                    .footnote()
            }
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
        Group {
            Section {
                LabeledContent("Kept") {
                    Text(library.reports.isEmpty
                         ? "None yet"
                         : "\(library.reports.count) · \(size)")
                }
                LabeledContent("Location") {
                    Button("Reveal in Finder") {
                        NSWorkspace.shared.activateFileViewerSelecting([library.location])
                    }
                }
            } footer: {
                Text("Every finished run is written as the exact JSON the engine produced, so a "
                     + "report saved by one version still opens in the next — and `jq` works on it. "
                     + "The forty most recent are kept.").footnote()
            }

            Section {
                LabeledContent("Delete all") {
                    Button("Delete…", role: .destructive) { confirming = true }
                        .disabled(library.reports.isEmpty)
                }
            } footer: {
                Text("Removes every kept report from this machine. The sites are not touched, and "
                     + "nothing is sent anywhere — these files never left it.").footnote()
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
        Group {
            Section {
                LabeledContent("Version") {
                    Text(updates.current.description).font(.system(.body, design: .monospaced))
                }
            } footer: {
                Text(updates.available == nil
                     ? "This is the newest release this app knows about."
                     : "A newer release is out. Open Versions from the sidebar to read what changed "
                       + "and move to it.").footnote()
            }

            Section {
                Toggle("Check automatically", isOn: Binding(get: { updates.automatic },
                                                           set: { updates.automatic = $0 }))
                LabeledContent("Last checked") {
                    HStack(spacing: 10) {
                        if updates.checking { ProgressView().controlSize(.small) }
                        Text(updates.lastChecked.map {
                            $0.formatted(date: .abbreviated, time: .shortened)
                        } ?? "Never")
                        Button("Check now") { Task { await updates.check() } }
                            .disabled(updates.checking)
                    }
                }
            } footer: {
                Text("Once a day at most, and off is a real preference: it is one request to GitHub "
                     + "about which software you run. The list is kept, so the Versions sheet is "
                     + "never empty after one successful check."
                     + (updates.problem.map { " \($0)" } ?? "")).footnote()
            }
        }
    }
}

/// The grey explanatory line under a group. One modifier so every footer in
/// every pane is the same size and colour.
private extension View {
    func footnote() -> some View {
        self.font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}
