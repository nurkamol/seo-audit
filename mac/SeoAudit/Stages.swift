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
                        .glassEffect(.regular, in: .rect(cornerRadius: 15))

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
                }
                .frame(maxWidth: 520)
                .padding(26)
                .glassEffect(.regular, in: .rect(cornerRadius: 28))
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
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
        .glassEffectID("stage", in: stage)
        .transition(.opacity.combined(with: .scale(scale: 0.98)))
    }
}
