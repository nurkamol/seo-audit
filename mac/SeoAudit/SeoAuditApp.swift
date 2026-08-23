// seo-audit for macOS.
//
// A window over the engine, and nothing else. The checks live in ../src, the
// server it talks to is `node bin/seo-audit.mjs --serve`, and there is no
// second implementation of anything here — a check written twice is a check
// that drifts, and this project ships several a week.

import SwiftUI

enum Links {
    static let site = URL(string: "https://nurkamol.github.io/seo-audit/")!
    static let repo = URL(string: "https://github.com/nurkamol/seo-audit")!
    static let issues = URL(string: "https://github.com/nurkamol/seo-audit/issues/new")!
    static let changelog = URL(string: "https://github.com/nurkamol/seo-audit/blob/main/CHANGELOG.md")!
    static let checks = URL(string: "https://github.com/nurkamol/seo-audit#what-it-checks")!
    static let licence = URL(string: "https://github.com/nurkamol/seo-audit/blob/main/LICENSE")!

    static func open(_ url: URL) { NSWorkspace.shared.open(url) }
}

@main
struct SeoAuditApp: App {
    @StateObject private var engine = Engine()
    @State private var showingAbout = false

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(engine)
                .frame(minWidth: 880, minHeight: 620)
                .sheet(isPresented: $showingAbout) { AboutSheet() }
                .onReceive(NotificationCenter.default.publisher(for: .showAbout)) { _ in showingAbout = true }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 840)
        .commands {
            CommandGroup(replacing: .newItem) {}

            // The standard About panel lists a bundle's metadata; this one can
            // say what the app is and link to the thing it is a window over.
            CommandGroup(replacing: .appInfo) {
                Button("About SEO Audit") { NotificationCenter.default.post(name: .showAbout, object: nil) }
            }

            CommandGroup(after: .saveItem) {
                Button("Export Report…") { NotificationCenter.default.post(name: .exportReport, object: nil) }
                    .keyboardShortcut("e", modifiers: .command)
            }

            CommandGroup(replacing: .help) {
                Button("SEO Audit Help") { Links.open(Links.site) }
                    .keyboardShortcut("?", modifiers: .command)
                Button("What it checks") { Links.open(Links.checks) }
                Divider()
                Button("Source on GitHub") { Links.open(Links.repo) }
                Button("Release notes") { Links.open(Links.changelog) }
                Button("Report an issue") { Links.open(Links.issues) }
            }
        }
    }
}

extension Notification.Name {
    static let exportReport = Notification.Name("seo-audit.exportReport")
    static let showAbout = Notification.Name("seo-audit.showAbout")
}

struct AboutSheet: View {
    @Environment(\.dismiss) private var dismiss

    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }

    /// Whether this build carries its own Node, which is the difference between
    /// a 110 MB app that runs anywhere and a 2 MB one that needs a toolchain.
    private var engineNote: String {
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("node").path
        let carried = bundled.map { FileManager.default.isExecutableFile(atPath: $0) } ?? false
        return carried ? "Engine bundled" : "Engine uses the Node on this machine"
    }

    var body: some View {
        VStack(spacing: 18) {
            if let icon = NSImage(named: "NSApplicationIcon") {
                Image(nsImage: icon).resizable().frame(width: 88, height: 88)
            }

            VStack(spacing: 5) {
                Text("SEO Audit").font(.system(size: 22, weight: .semibold, design: .rounded))
                Text("Version \(version) · \(engineNote)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text("Every page, not just the homepage.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Text("""
                A window over the command-line tool, not a second copy of it. The checks \
                run in the same engine the terminal and the GitHub Action use, so a report \
                from here and one from `seo-audit --json` are the same report.
                """)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 380)

            HStack(spacing: 10) {
                Button("Website") { Links.open(Links.site) }.buttonStyle(.glass)
                Button("GitHub") { Links.open(Links.repo) }.buttonStyle(.glass)
                Button("Licence") { Links.open(Links.licence) }.buttonStyle(.glass)
            }

            Button("Done") { dismiss() }
                .buttonStyle(.glass)
                .keyboardShortcut(.defaultAction)
        }
        .padding(32)
        .frame(width: 460)
        .background(Backdrop())
    }
}
