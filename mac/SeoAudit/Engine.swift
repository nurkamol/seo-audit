// The engine process: the same CLI the terminal runs, started with --serve, and
// read as a stream of events.
//
// Both node and the CLI are inside the bundle, so nothing has to be installed
// for this to work. The child is handed a pipe for stdin — when this app goes,
// the pipe closes and the server exits, which is a bug the first version had:
// it left a server holding the port and the next launch failed.

import Foundation

@MainActor
final class Engine: ObservableObject, AuditEngine {
    enum State: Equatable {
        case starting
        case ready(URL)
        case failed(String)
    }

    @Published private(set) var state: State = .starting

    /// Where the engine is listening, for anything that needs to ask it
    /// something other than "run an audit".
    var base: URL? { if case .ready(let url) = state { url } else { nil } }
    private let process = Process()

    /// Everything the engine needs, carried inside the bundle. A build made
    /// with --no-node has no node of its own and falls back to the machine's.
    private var engine: (node: String, cli: String)? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        let cli = resources.appendingPathComponent("engine/bin/seo-audit.mjs").path
        guard FileManager.default.fileExists(atPath: cli) else { return nil }

        let bundled = resources.appendingPathComponent("node").path
        if FileManager.default.isExecutableFile(atPath: bundled) { return (bundled, cli) }

        let installed = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
            .first { FileManager.default.isExecutableFile(atPath: $0) }
        return installed.map { ($0, cli) }
    }

    func start() async {
        guard state == .starting, !process.isRunning else { return }
        guard let engine else {
            state = .failed("""
                This build has no engine to run.

                mac/build.sh puts the CLI and a Node inside the bundle. A build made \
                with --no-node uses the Node already on this machine, and could not \
                find one — install it with `brew install node`.
                """)
            return
        }

        process.executableURL = URL(fileURLWithPath: engine.node)
        // Port 0: the operating system picks one that is free, and the server
        // prints where it landed. Guessing a port is how two copies of an app
        // fight over one.
        process.arguments = [engine.cli, "--serve", "0"]
        process.standardInput = Pipe()
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output

        do {
            try process.run()
        } catch {
            state = .failed("The audit engine would not start: \(error.localizedDescription)")
            return
        }

        let found = await Self.firstAnnouncedURL(from: output.fileHandleForReading)
        state = found.map(State.ready) ?? .failed("The engine started but never said where it was listening.")
    }

    /// The engine prints where it is listening once it has bound a port. This
    /// waits for that line and gives up after fifteen seconds.
    ///
    /// The buffer lives in a locked box rather than a captured `var`: the pipe
    /// calls back on its own queue, and a mutable capture there is a data race
    /// the Swift 6 language mode refuses outright.
    private static func firstAnnouncedURL(from handle: FileHandle) async -> URL? {
        final class Buffer: @unchecked Sendable {
            private let lock = NSLock()
            private var text = ""
            private var done = false

            func take(_ chunk: Data) -> URL? {
                lock.lock()
                defer { lock.unlock() }
                guard !done else { return nil }
                text += String(decoding: chunk, as: UTF8.self)
                guard let announced = text.range(of: "serving at "),
                      let end = text[announced.upperBound...].firstIndex(where: { $0.isWhitespace }),
                      let url = URL(string: String(text[announced.upperBound..<end]))
                else { return nil }
                done = true
                return url
            }

            /// Closes the door, so a timeout and an answer cannot both resume.
            func giveUp() -> Bool {
                lock.lock()
                defer { lock.unlock() }
                if done { return false }
                done = true
                return true
            }
        }

        let buffer = Buffer()
        return await withCheckedContinuation { continuation in
            handle.readabilityHandler = { pipe in
                let chunk = pipe.availableData
                guard !chunk.isEmpty, let url = buffer.take(chunk) else { return }
                handle.readabilityHandler = nil
                continuation.resume(returning: url)
            }
            Task {
                try? await Task.sleep(for: .seconds(15))
                if buffer.giveUp() {
                    handle.readabilityHandler = nil
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    // MARK: - AuditEngine

    /// Server-sent events from the engine, turned into something SwiftUI can
    /// iterate. `format=json` asks for the findings rather than a rendered
    /// page — the grouping travels with them, computed once, in the engine.
    nonisolated func run(site: String, limit: Int) -> AsyncStream<AuditEvent> {
        AsyncStream { continuation in
            let work = Task {
                guard case .ready(let base) = await state else {
                    continuation.yield(.failed("The engine is not running."))
                    continuation.finish()
                    return
                }
                var components = URLComponents(url: base.appending(path: "stream"), resolvingAgainstBaseURL: false)!
                components.queryItems = [
                    .init(name: "url", value: site),
                    .init(name: "limit", value: String(limit)),
                    .init(name: "format", value: "json"),
                ]

                do {
                    let (bytes, _) = try await URLSession.shared.bytes(from: components.url!)
                    var event = ""
                    for try await line in bytes.lines {
                        if line.hasPrefix("event: ") {
                            event = String(line.dropFirst(7))
                        } else if line.hasPrefix("data: ") {
                            let payload = Data(String(line.dropFirst(6)).utf8)
                            switch event {
                            case "progress":
                                if let text = try? JSONDecoder().decode(String.self, from: payload) {
                                    continuation.yield(.progress(text))
                                }
                            case "done":
                                if let report = try? JSONDecoder().decode(Report.self, from: payload) {
                                    continuation.yield(.finished(report, raw: payload))
                                } else {
                                    continuation.yield(.failed("The engine sent a report this app could not read."))
                                }
                            case "failed":
                                let why = (try? JSONDecoder().decode(String.self, from: payload)) ?? "unknown"
                                continuation.yield(.failed(why))
                            default:
                                break
                            }
                        }
                    }
                } catch {
                    continuation.yield(.failed(error.localizedDescription))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in work.cancel() }
        }
    }

    func stop() {
        if process.isRunning { process.terminate() }
    }
}
