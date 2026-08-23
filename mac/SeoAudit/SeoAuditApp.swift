// seo-audit for macOS.
//
// A window over the engine, and nothing else. The checks live in ../src, the
// server it talks to is `node bin/seo-audit.mjs --serve`, and there is no
// second implementation of anything here — a check written twice is a check
// that drifts, and this project ships several a week.
//
// What this adds over the CLI is what a window can add: a place to keep the
// sites you audit, a report you can export without a print dialog, and no
// limits of any kind, because the crawl is bounded only by this machine.

import SwiftUI

@main
struct SeoAuditApp: App {
    @StateObject private var engine = Engine()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(engine)
                .frame(minWidth: 880, minHeight: 620)
                .task { await engine.start() }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 840)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .saveItem) {
                Button("Export Report as PDF…") { NotificationCenter.default.post(name: .exportPDF, object: nil) }
                    .keyboardShortcut("e", modifiers: .command)
            }
        }
    }
}

extension Notification.Name {
    static let exportPDF = Notification.Name("seo-audit.exportPDF")
}
