// What an audit produces, and who produces it.
//
// The protocol is the seam. Today one implementation spawns the bundled CLI and
// reads its stream; if the engine is ever rewritten in Swift, that is a second
// conformance and nothing above this line changes. The models are the shape the
// tool's own --json output already has, which is the shape a Swift engine would
// have to produce anyway.

import Foundation

struct Finding: Decodable, Identifiable, Hashable {
    let level: Level
    let id: String
    let title: String
    let detail: String
    let url: String?
    let indexable: Bool?
    let reach: Reach?
    let traffic: Traffic?

    // Findings repeat their id across pages, so identity is id + url.
    var identity: String { "\(id)|\(url ?? "")" }

    enum Level: String, Decodable, CaseIterable, Comparable {
        case error, warn, info

        var label: String { self == .error ? "Error" : self == .warn ? "Warning" : "Note" }
        var order: Int { self == .error ? 0 : self == .warn ? 1 : 2 }
        static func < (a: Level, b: Level) -> Bool { a.order < b.order }
    }

    struct Reach: Decodable, Hashable {
        let inlinks: Int
        let depth: Int?
    }

    struct Traffic: Decodable, Hashable {
        let impressions: Int
        let clicks: Int
    }
}

/// A group of findings that are one piece of work. Grouped by the engine, not
/// here: `byCause()` in src/causes.mjs is the only implementation of that rule,
/// and a second one in Swift is exactly the drift this project keeps refusing.
struct Cause: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let level: Finding.Level
    let section: String
    let count: Int
    let pages: [String]
    let scope: String

    var identity: String { "\(id)|\(section)" }
}

struct Meta: Decodable, Hashable {
    let origin: String
    let pages: Int
    let requests: Int?
    let ms: Int?
    let date: String?
    let notIndexable: Int?
    let ignored: Int?
}

struct Report: Decodable, Hashable {
    let meta: Meta
    let findings: [Finding]
    let causes: [Cause]

    var counts: (error: Int, warn: Int, info: Int) {
        (findings.filter { $0.level == .error }.count,
         findings.filter { $0.level == .warn }.count,
         findings.filter { $0.level == .info }.count)
    }

    func findings(for cause: Cause) -> [Finding] {
        findings.filter { $0.id == cause.id && cause.pages.contains($0.url ?? "") }
    }
}

/// What a run emits while it happens.
enum AuditEvent {
    case progress(String)
    case finished(Report, raw: Data)
    case failed(String)
}

/// The seam. One method, one stream of events.
///
/// Today: `LocalEngine`, which spawns the bundled CLI. Tomorrow, if the checks
/// are ever written in Swift, a second conformance — and every view, every
/// animation and every model above this line stays exactly as it is.
protocol AuditEngine {
    func run(site: String, limit: Int) -> AsyncStream<AuditEvent>
}
