// The window: a glass sidebar of sites you have audited, and a stage that
// morphs between asking, crawling and reading.

import SwiftUI

@MainActor
final class Session: ObservableObject {
    @Published var lines: [String] = []
    @Published var report: Report?
    /// Exactly what the engine sent, kept so a JSON export cannot quietly drop
    /// a field these models do not know about yet.
    @Published var raw: Data?
    @Published var failure: String?
    @Published var running: Run?

    private var task: Task<Void, Never>?

    /// Open a report that was already on disk, without crawling anything.
    /// The row in the library this report is, when it is one. A run in progress
    /// is not one until it finishes.
    @Published private(set) var openedFrom: StoredReport?

    func show(_ report: Report, raw: Data, for run: Run, from stored: StoredReport? = nil) {
        cancel()
        lines = []
        failure = nil
        running = run
        openedFrom = stored
        self.raw = raw
        self.report = report
    }

    func begin(_ run: Run, using engine: some AuditEngine, settings: CrawlSettings,
               keeping library: Library? = nil) {
        cancel()
        lines = []
        report = nil
        raw = nil
        failure = nil
        running = run
        openedFrom = nil
        task = Task { [weak self] in
            for await event in engine.run(query: settings.queryItems(for: run)) {
                guard let self else { return }
                switch event {
                case .progress(let line):
                    // A crawl of five thousand pages would otherwise keep every
                    // line of it in memory to show the last twenty.
                    self.lines.append(line)
                    if self.lines.count > 400 { self.lines.removeFirst(self.lines.count - 400) }
                case .finished(let report, let raw):
                    self.raw = raw
                    // Kept before it is shown: a crash while rendering should
                    // still leave the seven minutes on disk.
                    // Which stored row this view is of, so "compare with" can
                    // offer every other run of the site and never itself.
                    self.openedFrom = library?.keep(report, site: run.url, raw: raw)
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.82)) { self.report = report }
                case .failed(let why):
                    withAnimation(.snappy) { self.failure = why }
                }
            }
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
    }

    func clear() {
        cancel()
        withAnimation(.spring(response: 0.45, dampingFraction: 0.82)) {
            running = nil
            report = nil
            raw = nil
            failure = nil
            lines = []
        }
    }
}

struct ContentView: View {
    @EnvironmentObject private var engine: Engine
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var updates: Updates
    @StateObject private var session = Session()
    @EnvironmentObject private var settings: CrawlSettings

    @State private var site = ""
    @State private var showingVersions = false
    @AppStorage("seo-audit.updates.dismissed") private var dismissedUpdate = ""
    @State private var comparing: Pair?
    @State private var plan: Preview?
    @State private var previewing = false

    /// The two runs a comparison sheet is about. Identifiable so `.sheet(item:)`
    /// can carry them, which is what makes the sheet impossible to open with
    /// nothing to compare.
    private struct Pair: Identifiable {
        let earlier: StoredReport
        let host: String
        var id: String { earlier.id.uuidString }
    }
    @Namespace private var stage

    var body: some View {
        NavigationSplitView {
            Sidebar(library: library, updates: updates, showingVersions: $showingVersions) { stored in
                guard let (report, raw) = library.reopen(stored) else { return }
                withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                    session.show(report, raw: raw, for: Run(url: stored.site, limit: stored.pages), from: stored)
                }
            } again: { url in
                site = url
                start()
            } newAudit: {
                startOver()
            } export: { stored, format in
                // Reopened from disk rather than from whatever is on screen, so
                // the file written is the run that was right-clicked.
                guard let (report, raw) = library.reopen(stored) else { return }
                Export.save(format, report: report, host: stored.host,
                            engine: engine.base, raw: raw)
            }
            .navigationSplitViewColumnWidth(min: 214, ideal: 244, max: 320)
            .onReceive(NotificationCenter.default.publisher(for: .newAudit)) { _ in startOver() }
            .sheet(item: $comparing) { pair in
                if let later = session.openedFrom ?? library.mostRecent(of: pair.host) {
                    ComparisonSheet(host: pair.host, earlier: pair.earlier, later: later, library: library)
                        .environmentObject(engine)
                }
            }
        } detail: {
            ZStack {
                Backdrop()
                content
                // An update nobody is told about is an update nobody installs.
                // Until now this only showed in Settings, which somebody has to
                // think to open — so the app knew for a week and said nothing.
                // Dismissible, and it stays dismissed for that version: a bar
                // that comes back every launch is a bar people learn to ignore.
                if let newer = updates.available, dismissedUpdate != newer.tagName {
                    VStack {
                        UpdateBanner(
                            updates: updates,
                            release: newer,
                            onDismiss: { withAnimation(.snappy) { dismissedUpdate = newer.tagName } },
                            onDetails: { showingVersions = true },
                        )
                        .padding(.horizontal, 18)
                        .padding(.top, 12)
                        Spacer()
                    }
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: updates.available)
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: engine.state)
        }
        .navigationTitle("")
        .sheet(isPresented: $showingVersions) { VersionsSheet(updates: updates) }
        .task { await engine.start() }
        .task {
            await updates.checkIfDue()
            updates.beginPeriodicChecks()
        }
    }

    @ViewBuilder private var content: some View {
        switch engine.state {
        case .starting:
            Card { ProgressView().controlSize(.large); Text("Starting the engine").foregroundStyle(.secondary) }
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
        case .failed(let why):
            Card(alignment: .leading) {
                Label("SEO Audit could not start", systemImage: "exclamationmark.triangle").font(.headline)
                Text(why).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
            }
            .frame(maxWidth: 520)
        case .ready:
            if let report = session.report, let run = session.running {
                ReportView(report: report, site: run.url,
                           earlierRuns: library.otherRuns(of: run.host, besides: session.openedFrom),
                           back: session.clear,
                           export: { format in
                               Export.save(format, report: report, host: run.host,
                                           engine: engine.base, raw: session.raw)
                           },
                           compare: { earlier in comparing = Pair(earlier: earlier, host: run.host) },
                           silence: { id in withAnimation(.snappy) { settings.silence(id) } })
                .transition(.asymmetric(insertion: .opacity.combined(with: .offset(y: 10)), removal: .opacity))
            } else if let failure = session.failure {
                Card(alignment: .leading) {
                    Label("The audit stopped", systemImage: "exclamationmark.triangle").font(.headline)
                    Text(failure).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                    Button("Try again", action: session.clear).buttonStyle(.glass).padding(.top, 4)
                }
                .frame(maxWidth: 520)
            } else if let run = session.running {
                CrawlStage(host: run.host, lines: session.lines, stage: stage) { session.clear() }
            } else {
                AskStage(site: $site, limit: $settings.limit, stage: stage, begin: start,
                         preview: runPreview, plan: plan, previewing: previewing)
                    .onChange(of: site) { _, _ in plan = nil }
            }
        }
    }

    /// Back to the field, from wherever. A crawl in progress is stopped rather
    /// than left running into a window that is no longer showing it.
    private func startOver() {
        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
            session.clear()
        }
        site = ""
        plan = nil
    }

    /// A few requests instead of a few hundred, answering "is this the right
    /// site and how big is it" before the minutes are spent.
    private func runPreview() {
        guard let url = Run.normalise(site) else { return }
        previewing = true
        Task {
            let found = await Preview.of(Run(url: url, limit: settings.limit),
                                         settings: settings, engine: engine.base)
            withAnimation(.snappy) { plan = found }
            previewing = false
        }
    }

    private func start() {
        guard let url = Run.normalise(site) else { return }
        let run = Run(url: url, limit: settings.limit)
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            session.begin(run, using: engine, settings: settings, keeping: library)
        }
    }
}

/// The colour behind the glass. Liquid Glass is a material: with nothing to
/// refract it reads as a grey box, so there is something here to bend.
struct Backdrop: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        LinearGradient(
            colors: scheme == .dark
                ? [Color(red: 0.07, green: 0.08, blue: 0.11), Color(red: 0.11, green: 0.09, blue: 0.07)]
                : [Color(red: 0.98, green: 0.97, blue: 0.96), Color(red: 0.94, green: 0.95, blue: 0.98)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(Color.orange.opacity(scheme == .dark ? 0.16 : 0.10))
                .frame(width: 460, height: 460)
                .blur(radius: 120)
                .offset(x: 140, y: -180)
        }
        .ignoresSafeArea()
    }
}

struct Card<Content: View>: View {
    var alignment: HorizontalAlignment = .center
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: alignment, spacing: 12) { content }
            .padding(28)
            .glassEffect(.regular, in: .rect(cornerRadius: Radius.surface))
    }
}

/// A quiet line across the top of the report, not a modal.
///
/// A new version is worth mentioning and never worth interrupting somebody
/// mid-crawl for — so it sits above the work rather than in front of it, and it
/// can be dismissed for good. It carries the download itself, because "there is
/// an update" and "here is how to get it" being in two different windows is how
/// the old arrangement managed to say nothing useful for a week.
struct UpdateBanner: View {
    @ObservedObject var updates: Updates
    let release: Release
    let onDismiss: () -> Void
    let onDetails: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: "arrow.down.circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(.tint)

            VStack(alignment: .leading, spacing: 2) {
                Text("Version \(release.version.description) is available")
                    .font(.system(.body, design: .rounded).weight(.semibold))
                Text(subtitle)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            if case .downloading(let fraction, _, _) = updates.downloadState {
                // Narrow on purpose: the banner is a line, and a full-width bar
                // here would read as the crawl's progress rather than a
                // download's.
                Group {
                    if let fraction { ProgressView(value: min(max(fraction, 0), 1)) }
                    else { ProgressView() }
                }
                .frame(width: 120)
            } else if case .ready(let app) = updates.downloadState {
                Button("Show in Finder") { updates.reveal(app) }
                    .buttonStyle(.borderedProminent)
            } else if case .unpacking = updates.downloadState {
                ProgressView().controlSize(.small)
            } else {
                Button("What's new") { onDetails() }
                Button(isHomebrew ? "Upgrade…" : "Download") {
                    Task { await updates.download(release) }
                }
                .buttonStyle(.borderedProminent)
            }

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Not now")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(.quaternary, lineWidth: 1),
        )
        .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
    }

    private var subtitle: String {
        switch updates.downloadState {
        case .failed(let why): why
        case .unpacking: "Unpacking…"
        case .ready: "Drag it into Applications, replacing this one."
        case .downloading: "Downloading…"
        case .idle: isHomebrew ? "Homebrew installed this one." : "You are on \(updates.current.description)."
        }
    }

    private var isHomebrew: Bool {
        if case .homebrew = updates.install { return true }
        return false
    }
}
