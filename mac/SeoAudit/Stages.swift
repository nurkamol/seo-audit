// Asking for a site, watching it crawl, and reading what came back.
//
// One surface that morphs rather than three screens that replace each other:
// `glassEffectID` inside a `GlassEffectContainer` is what makes the card the
// question was asked in become the card the answer arrives in.

import SwiftUI

/// One audit: where it was pointed and how far it was allowed to go.
struct Run: Equatable, Identifiable {
    let id = UUID()
    let url: String
    let limit: Int

    /// What somebody types is not always a URL. "example.com" is what people
    /// type, and refusing it would be pedantry rather than accuracy.
    static func normalise(_ typed: String) -> String? {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let withScheme = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: withScheme), let host = url.host, host.contains(".") else { return nil }
        return url.absoluteString
    }

    var host: String { URL(string: url)?.host ?? url }
}

struct AskStage: View {
    @Binding var site: String
    @Binding var limit: Int
    var stage: Namespace.ID
    var begin: () -> Void
    var preview: () -> Void = {}
    /// What the last preview found, or nil before one has been asked for.
    var plan: Preview?
    var previewing = false

    @FocusState private var focused: Bool
    @State private var appeared = false

    var body: some View {
        GlassEffectContainer(spacing: 22) {
            VStack(spacing: 26) {
                VStack(spacing: 8) {
                    Text("Audit every page")
                        .font(.system(size: 34, weight: .semibold, design: .rounded))
                    Text("Not just the homepage. Nothing leaves this machine.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 16) {
                    TextField("example.com", text: $site)
                        .textFieldStyle(.plain)
                        .font(.system(size: 19, design: .rounded))
                        .focused($focused)
                        .onSubmit(begin)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 14)
                        .glassEffect(.regular, in: .rect(cornerRadius: Radius.control))

                    HStack(spacing: 14) {
                        Text("Pages at most")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                        Stepper(value: $limit, in: 10...5000, step: 10) {
                            Text("\(limit)")
                                .font(.system(.callout, design: .monospaced))
                                .contentTransition(.numericText())
                                .animation(.snappy, value: limit)
                        }
                        .fixedSize()
                        Spacer(minLength: 0)
                        // A few requests instead of a few hundred: how big is
                        // this site, and is this even the right one. A full
                        // crawl is minutes of waiting and a lot of somebody
                        // else's bandwidth to find that out the other way.
                        Button(action: preview) {
                            if previewing {
                                ProgressView().controlSize(.small)
                            } else {
                                Label("Preview", systemImage: "binoculars")
                            }
                        }
                        .buttonStyle(.glass)
                        .disabled(Run.normalise(site) == nil || previewing)
                        Button(action: begin) {
                            Label("Audit", systemImage: "arrow.right")
                                .font(.headline)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                        }
                        .buttonStyle(.glass)
                        .keyboardShortcut(.defaultAction)
                        .disabled(Run.normalise(site) == nil)
                    }

                    if let plan { PreviewSummary(plan: plan, limit: limit) }
                }
                .frame(maxWidth: 520)
                .padding(26)
                .glassEffect(.regular, in: .rect(cornerRadius: Radius.surface))
                .glassEffectID("stage", in: stage)
            }
            .padding(40)
        }
        .scaleEffect(appeared ? 1 : 0.96)
        .opacity(appeared ? 1 : 0)
        .onAppear {
            withAnimation(.spring(response: 0.55, dampingFraction: 0.8)) { appeared = true }
            focused = true
        }
    }
}

/// A crawl takes minutes. The log is the only honest thing to show while it
/// does, and it is the same stream the terminal prints.
struct CrawlStage: View {
    let host: String
    let lines: [String]
    var stage: Namespace.ID
    var cancel: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                ProgressView().controlSize(.small)
                Text("Crawling \(host)")
                    .font(.system(.headline, design: .rounded))
                Spacer(minLength: 0)
                Button("Stop", action: cancel).buttonStyle(.glass)
            }

            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                            Text(line)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(index)
                        }
                    }
                    .padding(12)
                }
                .onChange(of: lines.count) { _, count in
                    withAnimation(.easeOut(duration: 0.2)) { scroll.scrollTo(count - 1, anchor: .bottom) }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: 320)
        }
        .padding(24)
        .frame(maxWidth: 640)
        .glassEffect(.regular, in: .rect(cornerRadius: Radius.surface))
        .glassEffectID("stage", in: stage)
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    }
}

/// What a run would do, without doing it. The engine's `preview()`, which the
/// command line reaches with `--dry-run`.
struct Preview: Decodable {
    let origin: String
    let reachable: Bool
    let rateLimited: Bool
    let sitemap: String?
    let listed: Int
    let wouldCheck: Int?
    let skippedByLimit: Int
    let requests: Int
    let ms: Int
    let sections: [Section]

    struct Section: Decodable, Identifiable {
        let path: String
        let count: Int
        var id: String { path }
    }

    @MainActor
    static func of(_ run: Run, settings: CrawlSettings, engine: URL?) async -> Preview? {
        guard let engine else { return nil }
        var components = URLComponents(url: engine.appending(path: "preview"), resolvingAgainstBaseURL: false)!
        // The same settings the run would use, minus the ones a preview has no
        // opinion about — otherwise it would describe a different crawl.
        components.queryItems = settings.queryItems(for: run).filter { $0.name != "format" && $0.name != "external" }
        guard let url = components.url,
              let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200
        else { return nil }
        return try? JSONDecoder().decode(Preview.self, from: data)
    }
}

private struct PreviewSummary: View {
    let plan: Preview
    let limit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider()
            if !plan.reachable {
                Label(plan.rateLimited
                      ? "Every request came back 429. Wait, or set the speed to Gentle."
                      : "Nothing answered at \(plan.origin).",
                      systemImage: "exclamationmark.triangle")
                    .font(.callout)
            } else if plan.sitemap == nil {
                Label("No sitemap. Links would be followed from the home page instead, up to \(limit) pages.",
                      systemImage: "questionmark.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(plan.listed)").font(.title3.weight(.semibold))
                    Text("URLs listed ·").foregroundStyle(.secondary)
                    Text("\(plan.wouldCheck ?? limit)").font(.title3.weight(.semibold))
                    Text("would be checked").foregroundStyle(.secondary)
                }
                .font(.callout)
                if plan.skippedByLimit > 0 {
                    Text("\(plan.skippedByLimit) past the limit of \(limit). Raise it to check them all.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if plan.sections.count > 1 {
                    Text(plan.sections.prefix(4).map { "\($0.path) \($0.count)" }.joined(separator: "   "))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
            Text("\(plan.requests) requests, \(String(format: "%.1f", Double(plan.ms) / 1000))s — no page was fetched.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .transition(.opacity.combined(with: .offset(y: -6)))
    }
}
