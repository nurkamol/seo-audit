// Two runs of one site, and what moved between them.
//
// "Did my fix work" is the question that makes somebody open a tool a second
// time, and until now this app could not answer it: it had been keeping every
// run since 1.23.0 and comparing none of them.
//
// The comparing is not done here. `diff()` has been in `src/baseline.mjs` since
// `--baseline` shipped, and the two sets are posted to the engine so that a
// comparison from this window and one from `seo-audit --baseline` are the same
// comparison. The grouping comes back with it, from the same `causePayload()`
// the report uses, so a regression across forty pages reads as one thing to fix
// rather than forty rows.

import SwiftUI

struct Comparison: Decodable {
    let previousDate: String?
    let unchanged: Int
    let added: Side
    let fixed: Side

    struct Side: Decodable {
        let findings: [Finding]
        let causes: [Cause]
    }

    var isUnchanged: Bool { added.causes.isEmpty && fixed.causes.isEmpty }

    /// Ask the engine. `nil` when it cannot be reached or refuses — the sheet
    /// says so rather than drawing an empty comparison, which would read as
    /// "nothing changed".
    @MainActor
    static func between(_ previous: Report, and current: Report, engine: URL?) async -> Comparison? {
        guard let engine else { return nil }
        var request = URLRequest(url: engine.appending(path: "diff"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(Request(
            previous: .init(meta: previous.meta, findings: previous.findings),
            current: .init(meta: current.meta, findings: current.findings),
        ))

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return try? JSONDecoder().decode(Comparison.self, from: data)
    }

    private struct Request: Encodable {
        let previous: Run
        let current: Run
        struct Run: Encodable {
            let meta: Meta
            let findings: [Finding]
        }
    }
}

// MARK: - The sheet

struct ComparisonSheet: View {
    let host: String
    let earlier: StoredReport
    let later: StoredReport
    @ObservedObject var library: Library
    @EnvironmentObject private var engine: Engine
    @Environment(\.dismiss) private var dismiss

    @State private var comparison: Comparison?
    @State private var problem: String?
    @State private var working = true

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if working {
                    centred { ProgressView().controlSize(.small) }
                } else if let problem {
                    centred {
                        ContentUnavailableView("Could not compare these runs",
                                               systemImage: "exclamationmark.triangle",
                                               description: Text(problem))
                    }
                } else if let comparison, comparison.isUnchanged {
                    centred {
                        ContentUnavailableView("Nothing moved",
                                               systemImage: "equal.circle",
                                               description: Text("\(comparison.unchanged) finding"
                                                                 + "\(comparison.unchanged == 1 ? "" : "s") "
                                                                 + "are exactly where they were."))
                    }
                } else if let comparison {
                    body(of: comparison)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(width: 760, height: 560)
        .background(Backdrop())
        .task { await compare() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(host).font(.system(.title3, design: .rounded).weight(.semibold))
                Text("\(later.finishedAt.formatted(date: .abbreviated, time: .shortened))"
                     + "  ·  compared with  ·  "
                     + "\(earlier.finishedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button("Done") { dismiss() }.buttonStyle(.glass).keyboardShortcut(.defaultAction)
        }
        .padding(20)
    }

    private func body(of comparison: Comparison) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !comparison.added.causes.isEmpty {
                    Changes(title: "Appeared", tint: .red, symbol: "arrow.up.right",
                          note: "Not there last time. Start here.",
                          causes: comparison.added.causes)
                }
                if !comparison.fixed.causes.isEmpty {
                    Changes(title: "Gone", tint: .green, symbol: "checkmark",
                          note: "Reported last time and not this time.",
                          causes: comparison.fixed.causes)
                }
                Text("\(comparison.unchanged) finding\(comparison.unchanged == 1 ? "" : "s") "
                     + "unchanged, and not listed — a comparison is for what moved.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(20)
        }
    }

    private func centred<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack { Spacer(); content(); Spacer() }
    }

    private func compare() async {
        working = true
        defer { working = false }
        guard let (before, _) = library.reopen(earlier), let (after, _) = library.reopen(later) else {
            problem = "One of these reports is no longer on disk."
            return
        }
        comparison = await Comparison.between(before, and: after, engine: engine.base)
        if comparison == nil { problem = "The engine did not answer." }
    }

    /// Named `Changes` rather than `Group`, which is SwiftUI's.
    private struct Changes: View {
        let title: String
        let tint: Color
        let symbol: String
        let note: String
        let causes: [Cause]

        var body: some View {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: symbol).foregroundStyle(tint)
                    Text("\(title) · \(causes.count)").font(.headline)
                    Text(note).font(.caption).foregroundStyle(.secondary)
                }
                // By identity, not by id: one check can be a cause under two
                // sections, and ForEach with a repeated id animates the wrong row.
                ForEach(causes, id: \.identity) { cause in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(cause.level.label.uppercased())
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.secondary)
                            .frame(width: 56, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(cause.title).font(.callout.weight(.medium))
                            Text(cause.scope).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .glassEffect(.regular, in: .rect(cornerRadius: Radius.control))
                }
            }
        }
    }
}
