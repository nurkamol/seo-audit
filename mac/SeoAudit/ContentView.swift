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
    func show(_ report: Report, raw: Data, for run: Run) {
        cancel()
        lines = []
        failure = nil
        running = run
        self.raw = raw
        self.report = report
    }

    func begin(_ run: Run, using engine: some AuditEngine, keeping library: Library? = nil) {
        cancel()
        lines = []
        report = nil
        raw = nil
        failure = nil
        running = run
        task = Task { [weak self] in
            for await event in engine.run(site: run.url, limit: run.limit) {
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
                    library?.keep(report, site: run.url, raw: raw)
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
    @StateObject private var library = Library()
    @StateObject private var session = Session()
    @StateObject private var updates = Updates()

    @State private var site = ""
    @State private var limit = 200
    @State private var showingVersions = false
    @Namespace private var stage

    var body: some View {
        NavigationSplitView {
            Sidebar(library: library, updates: updates, showingVersions: $showingVersions) { stored in
                guard let (report, raw) = library.reopen(stored) else { return }
                withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) {
                    session.show(report, raw: raw, for: Run(url: stored.site, limit: stored.pages))
                }
            } again: { url in
                site = url
                start()
            }
            .navigationSplitViewColumnWidth(min: 214, ideal: 244, max: 320)
        } detail: {
            ZStack {
                Backdrop()
                content
            }
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: engine.state)
        }
        .navigationTitle("")
        .sheet(isPresented: $showingVersions) { VersionsSheet(updates: updates) }
        .task { await engine.start() }
        .task { await updates.checkIfDue() }
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
                ReportView(report: report, site: run.url, back: session.clear) { format in
                    Export.save(format, report: report, host: run.host,
                                engine: engine.base, raw: session.raw)
                }
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
                AskStage(site: $site, limit: $limit, stage: stage, begin: start)
            }
        }
    }

    private func start() {
        guard let url = Run.normalise(site) else { return }
        let run = Run(url: url, limit: limit)
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
            session.begin(run, using: engine, keeping: library)
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
            .glassEffect(.regular, in: .rect(cornerRadius: 26))
    }
}
