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
        case crawl, coverage, identity, performance, searchConsole, silenced, reports, updates, help

        var id: String { rawValue }

        var title: String {
            switch self {
            case .crawl: "Crawl"
            case .coverage: "Coverage"
            case .identity: "Identify as"
            case .performance: "Performance"
            case .searchConsole: "Search Console"
            case .silenced: "Silenced"
            case .reports: "Reports"
            case .updates: "Updates"
            case .help: "Help"
            }
        }

        var symbol: String {
            switch self {
            case .crawl: "gauge.with.dots.needle.33percent"
            case .coverage: "square.grid.3x3"
            case .identity: "person.crop.square"
            case .performance: "speedometer"
            case .searchConsole: "chart.line.uptrend.xyaxis"
            case .silenced: "bell.slash"
            case .reports: "tray.full"
            case .updates: "arrow.down.circle"
            case .help: "questionmark.circle"
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
            case .searchConsole: .red
            case .silenced: .gray
            case .reports: .teal
            case .updates: .indigo
            case .help: .pink
            }
        }

        var blurb: String {
            switch self {
            case .crawl: "How hard to crawl, and how much of the site to read."
            case .coverage: "How many pages, and what else to follow."
            case .identity: "Who the crawler says it is."
            case .performance: "Measured by Google, never estimated here."
            case .searchConsole: "What these pages actually do in Google, rather than a proxy for it."
            case .silenced: "Checks you have decided you can live with."
            case .reports: "Every finished run, kept on this machine."
            case .updates: "New versions, and how to move between them."
            case .help: "What this reads, what it will not guess, and where a run goes."
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
        case .searchConsole: SearchConsolePane(settings: settings)
        case .silenced: SilencedPane(settings: settings)
        case .reports: ReportsPane(library: library)
        case .updates: UpdatesPane(updates: updates)
        case .help: HelpPane()
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
                     : "A newer release is out.").footnote()
            }

            if let newer = updates.available {
                Section {
                    UpdateAction(updates: updates, release: newer)
                } header: {
                    Text("Version \(newer.version.description) is available")
                }
            }

            Section {
                Toggle("Check automatically", isOn: Binding(get: { updates.automatic },
                                                           set: { updates.automatic = $0 }))
                // The date and the button on separate rows. Together, the
                // button took the width and the date truncated to "Aug 24, 2026
                // at 2:…" — a timestamp cut off before the time it states.
                LabeledContent("Last checked") {
                    Text(updates.lastChecked.map {
                        $0.formatted(date: .abbreviated, time: .shortened)
                    } ?? "Never")
                }
                LabeledContent("Check for a new version") {
                    HStack(spacing: 8) {
                        if updates.checking { ProgressView().controlSize(.small) }
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

/// What somebody asks the first time, answered where they are rather than in a
/// README they would have to go and find.
///
/// Written as questions the app actually raises — why a crawl takes minutes,
/// why a page count differs from the sitemap's, why performance is missing
/// unless it is switched on — rather than a tour of the controls. A control
/// that needs explaining is better renamed; a *decision* is what needs saying.
private struct HelpPaneAnswer: Identifiable {
    let id = UUID()
    let question: String
    let answer: String
}

private struct HelpPane: View {
    private typealias Answer = HelpPaneAnswer

    private let basics: [Answer] = [
        .init(question: "Where do the pages come from?",
              answer: "The sitemap, and every URL in it — not just the home page. That is the whole "
                    + "reason this exists: a language switcher that 404s on every translated article "
                    + "is invisible to a grader that only ever opens the front door. If there is no "
                    + "sitemap, it follows links from the home page instead."),
        .init(question: "Why does a crawl take minutes?",
              answer: "Because it reads every page, politely. The speed setting is how many requests "
                    + "run at once; Gentle exists for shared hosting that starts refusing under load. "
                    + "A run is kept when it finishes, so a crawl only ever has to happen once."),
        .init(question: "Why are there fewer pages than my sitemap lists?",
              answer: "The page limit, which is on the Crawl pane. The report says how many were left "
                    + "out rather than quietly stopping — a run that saw half the site and does not "
                    + "say so reads exactly like a healthy one."),
        .init(question: "What is a cause, and why not a list of problems?",
              answer: "One broken template on forty pages is one thing to fix, not forty. Findings are "
                    + "grouped by what has to change and ordered worst first, then by how much of the "
                    + "site points at them. Open a cause to see every page it is on."),
    ]

    private let judgement: [Answer] = [
        .init(question: "Where is my score out of 100?",
              answer: "There isn't one, deliberately. A score invites optimising for the grader rather "
                    + "than the reader, which is the failure the commercial tools encourage. Errors, "
                    + "warnings and notes are counted instead, and each says what it costs."),
        .init(question: "Why is performance blank?",
              answer: "Because nothing here measures it. A crawler cannot see rendering, and a "
                    + "plausible wrong number is worse than none. Switch on the Performance pane and "
                    + "it asks Google's PageSpeed Insights for Google's own field measurement — real "
                    + "numbers, or no numbers."),
        .init(question: "Something is reported that I am happy with.",
              answer: "Right-click it and silence the check. It stays silenced on this machine, and "
                    + "every report still says how many findings were silenced — a check somebody "
                    + "quietened must never read like one that passed."),
        .init(question: "A finding looks wrong.",
              answer: "Say so. A check that cries wolf gets the whole report ignored, so anything "
                    + "sometimes legitimate is a note rather than an error, and false positives are "
                    + "treated as bugs in the tool rather than facts about the site."),
    ]

    private let privacy: [Answer] = [
        .init(question: "Does anything leave this machine?",
              answer: "Only requests to the site being audited. No account, no telemetry, no server in "
                    + "between. The one exception is named and opt-in: turning on Performance sends "
                    + "the URLs you chose to Google's PageSpeed Insights, because that is whose "
                    + "measurement it is."),
        .init(question: "Where are my reports kept?",
              answer: "In Application Support on this machine, as the engine's own JSON — the same "
                    + "file the command line writes. Nothing is uploaded, and the Reports pane will "
                    + "show you the folder."),
        .init(question: "Is this the same as the command line?",
              answer: "The same engine, imported rather than reimplemented, so a report from this "
                    + "window and one from seo-audit --json are the same report. That is the rule "
                    + "that lets this project have five front ends without them drifting apart."),
    ]

    var body: some View {
        Group {
            Section("Getting a report") { ForEach(basics) { QuestionRow(answer: $0) } }
            Section("What it will and will not say") { ForEach(judgement) { QuestionRow(answer: $0) } }
            Section("Where things go") { ForEach(privacy) { QuestionRow(answer: $0) } }

            Section {
                LabeledContent("More, and the source") {
                    Link("github.com/nurkamol/seo-audit",
                         destination: URL(string: "https://github.com/nurkamol/seo-audit")!)
                }
                LabeledContent("Every check, in a table") {
                    Link("The README",
                         destination: URL(string: "https://github.com/nurkamol/seo-audit#what-it-checks")!)
                }
                LabeledContent("Something wrong?") {
                    Link("Open an issue",
                         destination: URL(string: "https://github.com/nurkamol/seo-audit/issues/new")!)
                }
            } footer: {
                Text("A false positive is a bug worth reporting. So is a check that fires on something "
                     + "you cannot act on.").footnote()
            }
        }
    }
}

/// One question, folded away. Expanded by default they would be a wall of prose
/// nobody reads; a list of questions is scannable, and the answer is one click
/// from the question it belongs to.
///
/// The row is the target, not the chevron. `DisclosureGroup` only hit-tests its
/// own triangle, which leaves a full-width row that looks clickable everywhere
/// and answers in one corner — the kind of thing that reads as the app being
/// broken rather than as a small disclosure control.
private struct QuestionRow: View {
    let answer: HelpPaneAnswer
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            Text(answer.answer)
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 2)
        } label: {
            Text(answer.question)
                .font(.body)
                // The whole width, and a shape to hit: without `contentShape`
                // only the glyphs themselves take a click, so the gaps between
                // words do nothing.
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture { withAnimation(.snappy) { expanded.toggle() } }
        }
    }
}

/// The one pane that needs an account, and says so.
///
/// Everything else this app orders by is derived from the site's own markup —
/// how many links point at a page, how far it is from the home page. Those are
/// proxies. Impressions are not: a broken canonical on a page with four
/// thousand impressions a month is a different sentence from the same canonical
/// on a page nobody has been shown.
///
/// Signing in runs the engine's own `--search-console-login`, which does the
/// loopback OAuth flow and writes the refresh token to `~/.config/seo-audit`.
/// The token never comes back through this process, and is never displayed:
/// this window asks for a sign-in and reads the list of properties that comes
/// out of it.
private struct SearchConsolePane: View {
    @ObservedObject var settings: CrawlSettings

    @State private var signingIn = false
    @State private var properties: [String] = []
    @State private var problem: String?

    var body: some View {
        Group {
            Section {
                TextField("sc-domain:example.com", text: $settings.searchConsoleProperty)
                    .textFieldStyle(.roundedBorder)
            } header: {
                Text("Property")
            } footer: {
                Text("Exactly as Search Console names it. A domain property is "
                     + "\"sc-domain:example.com\", not a URL — that mismatch is the usual reason the "
                     + "call comes back empty. Leave it blank and no account is used at all.")
                    .footnote()
            }

            Section {
                LabeledContent("Google account") {
                    Button(signingIn ? "Signing in…" : "Sign in…") { Task { await signIn() } }
                        .disabled(signingIn)
                }

                if let problem {
                    Text(problem)
                        .font(.callout)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }

                ForEach(properties, id: \.self) { property in
                    LabeledContent {
                        Button("Use this") { settings.searchConsoleProperty = property }
                            .disabled(settings.searchConsoleProperty == property)
                    } label: {
                        Text(property).font(.system(.body, design: .monospaced))
                    }
                }
            } footer: {
                Text("Opens a browser once. The refresh token is written to "
                     + "~/.config/seo-audit/.env, outside any repository, and never shown here — a "
                     + "token on screen is a token in a screenshot.")
                    .footnote()
            }

            Section {
                Text("Findings then sort by impressions where Google knows the page, and by how much "
                     + "of the site links to it where it does not. The window is 28 days ending three "
                     + "days ago, because Search Console reports its most recent days incompletely.")
                    .footnote()
            }
        }
    }

    /// Runs the engine's sign-in and keeps only what is safe to show: the names
    /// of the properties this account can read. A token that can read nothing
    /// looks exactly like one that works, right up until a run says the
    /// property was not found — so the list is the point, not a tick.
    private func signIn() async {
        guard let engine = Engine.bundled else {
            problem = "This build has no engine to run."
            return
        }
        signingIn = true
        problem = nil
        defer { signingIn = false }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: engine.node)
        process.arguments = [engine.cli, "--search-console-login"]
        let out = Pipe()
        process.standardOutput = out
        process.standardError = out

        do {
            try process.run()
            let data = try out.fileHandleForReading.readToEnd() ?? Data()
            process.waitUntilExit()
            let text = String(decoding: data, as: UTF8.self)

            // The engine prints one indented line per property, "name  (role)".
            let found = text
                .split(separator: "\n")
                .compactMap { line -> String? in
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    guard trimmed.contains("("), trimmed.hasPrefix("sc-domain:") || trimmed.hasPrefix("http")
                    else { return nil }
                    return trimmed.components(separatedBy: "  ").first?.trimmingCharacters(in: .whitespaces)
                }

            if found.isEmpty {
                // Whatever went wrong, the engine already said it in a sentence
                // written for a person. Repeating it beats inventing a worse one.
                problem = text
                    .split(separator: "\n")
                    .map { $0.trimmingCharacters(in: .whitespaces) }
                    .last { !$0.isEmpty }
                    ?? "Sign-in did not finish."
            } else {
                properties = found
                if settings.searchConsoleProperty.isEmpty { settings.searchConsoleProperty = found[0] }
            }
        } catch {
            problem = error.localizedDescription
        }
    }
}

/// The one control that moves somebody to a new version, wherever it is shown.
///
/// It does the slow part with a bar that means something and stops at the drag,
/// which is the step where macOS asks whether somebody really meant to replace
/// a running application. A Homebrew install skips all of it: `brew` verifies
/// what it downloads and keeps records this app has no business editing.
private struct UpdateAction: View {
    @ObservedObject var updates: Updates
    let release: Release

    var body: some View {
        switch updates.downloadState {
        case .idle, .failed:
            VStack(alignment: .leading, spacing: 8) {
                if case .failed(let why) = updates.downloadState {
                    Text(why).font(.callout).foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 10) {
                    Button(isHomebrew ? "Upgrade with Homebrew…" : "Download \(release.version.description)") {
                        Task { await updates.download(release) }
                    }
                    .buttonStyle(.borderedProminent)
                    Button("What changed") { updates.open(release) }
                }
                Text(isHomebrew
                     ? "Runs `\(updates.command(for: release))` in Terminal, where you can watch it "
                       + "happen. Homebrew asks questions this app should not answer for you."
                     : "Downloads the build attached to that release, unpacks it, and shows it to "
                       + "you in Finder. The last step is a drag you make on purpose.")
                    .footnote()
            }

        case .downloading(let fraction, let received, let total):
            VStack(alignment: .leading, spacing: 6) {
                if let fraction {
                    ProgressView(value: min(max(fraction, 0), 1))
                } else {
                    // No Content-Length, so no honest fraction. A bar that sits
                    // at zero and jumps to full is worse than admitting it.
                    ProgressView()
                }
                Text(total.map { "\(bytes(received)) of \(bytes($0))" } ?? bytes(received))
                    .font(.callout).foregroundStyle(.secondary).monospacedDigit()
            }

        case .unpacking:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Unpacking…").font(.callout).foregroundStyle(.secondary)
            }

        case .ready(let app):
            VStack(alignment: .leading, spacing: 8) {
                Label("Downloaded", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Button("Show in Finder") { updates.reveal(app) }
                    .buttonStyle(.borderedProminent)
                Text("Drag it into Applications, replacing this one, then reopen. Replacing an app "
                     + "while it runs is something to do deliberately rather than have done to you.")
                    .footnote()
            }
        }
    }

    private var isHomebrew: Bool {
        if case .homebrew = updates.install { return true }
        return false
    }

    private func bytes(_ n: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: n, countStyle: .file)
    }
}
