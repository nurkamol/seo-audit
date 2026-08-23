// A macOS window over the local server, and nothing more than that.
//
// The engine is the same `bin/seo-audit.mjs` the terminal runs: this starts it
// with `--serve` and points a web view at it. There is no second copy of any
// check here, and there deliberately never will be — a check written twice is a
// check that drifts, and this project ships several a week.
//
// Build:  swiftc -O -o build/SeoAudit mac/SeoAudit/main.swift
// Run:    build/SeoAudit  (looks for node and the CLI beside it)

import AppKit
import WebKit

/// Where the CLI is. A bundled app would carry it inside Resources; run from a
/// checkout it sits two directories up from this file.
func locateCLI() -> String? {
    let candidates = [
        Bundle.main.path(forResource: "seo-audit", ofType: "mjs"),
        FileManager.default.currentDirectoryPath + "/bin/seo-audit.mjs",
        ProcessInfo.processInfo.environment["SEO_AUDIT_BIN"],
    ]
    return candidates.compactMap { $0 }.first { FileManager.default.fileExists(atPath: $0) }
}

/// Node, wherever this machine keeps it. A bundled app should ship its own
/// rather than hope; this is the checkout case.
func locateNode() -> String? {
    let candidates = [
        "/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node",
        ProcessInfo.processInfo.environment["NODE_BIN"],
    ]
    return candidates.compactMap { $0 }.first { FileManager.default.isExecutableFile(atPath: $0) }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private let server = Process()
    private let port = 4321

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "seo-audit"
        window.center()

        webView = WKWebView(frame: window.contentView!.bounds)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        window.contentView!.addSubview(webView)
        window.makeKeyAndOrderFront(nil)

        guard let node = locateNode(), let cli = locateCLI() else {
            show(error: """
                Could not find node, or could not find bin/seo-audit.mjs.

                Run this from a checkout of the repository, or set NODE_BIN and
                SEO_AUDIT_BIN. A packaged build should carry both itself rather
                than hope they are installed.
                """)
            return
        }

        server.executableURL = URL(fileURLWithPath: node)
        server.arguments = [cli, "--serve", String(port)]
        // A pipe rather than the app's own stdin, so that when this process
        // goes — quit, crash, or killed — the pipe closes and the server sees
        // it and exits. Without this the port stays bound and the next launch
        // fails, which is how it behaved the first time it was run for real.
        server.standardInput = Pipe()
        do {
            try server.run()
        } catch {
            show(error: "The audit server would not start: \(error.localizedDescription)")
            return
        }
        waitForServer()
    }

    /// The server takes a moment to bind. Poll it rather than guessing at a
    /// sleep, because a first run that shows an error page for half a second is
    /// worse than one that takes half a second.
    private func waitForServer(attempt: Int = 0) {
        guard attempt < 40 else {
            show(error: "The audit server did not answer on port \(port).")
            return
        }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/robots.txt")!)
        request.timeoutInterval = 0.5
        URLSession.shared.dataTask(with: request) { _, response, _ in
            DispatchQueue.main.async {
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    self.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(self.port)/")!))
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        self.waitForServer(attempt: attempt + 1)
                    }
                }
            }
        }.resume()
    }

    private func show(error: String) {
        let escaped = error.replacingOccurrences(of: "<", with: "&lt;")
        webView.loadHTMLString(
            """
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <body style="font:14px/1.6 ui-sans-serif,system-ui;padding:3rem;color:#111827">
            <h1 style="font-size:1.2rem">seo-audit could not start</h1>
            <pre style="white-space:pre-wrap;color:#4b5563">\(escaped)</pre></body>
            """,
            baseURL: nil
        )
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        if server.isRunning { server.terminate() }
    }
}

// Quitting is not the only way this ends. A signal skips
// applicationWillTerminate entirely, and the child would be left holding the
// port, so the pipe above is the real guarantee and this is the tidy path.
signal(SIGTERM) { _ in exit(0) }
signal(SIGINT) { _ in exit(0) }

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
