// Every release, what changed in it, and the one command that moves you there.

import SwiftUI

struct VersionsSheet: View {
    @ObservedObject var updates: Updates
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Release?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Versions").font(.system(.title2, design: .rounded).weight(.semibold))
                    Text("You are on \(updates.current.description)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if updates.checking { ProgressView().controlSize(.small) }
                Button("Check now") { Task { await updates.check() } }
                    .buttonStyle(.glass)
                    .disabled(updates.checking)
                Button("Done") { dismiss() }.buttonStyle(.glass)
            }
            .padding(20)

            if let problem = updates.problem {
                Label(problem, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 8)
            }

            HStack(spacing: 0) {
                List(updates.releases, selection: $selected) { release in
                    Row(release: release, current: updates.current)
                        .tag(release)
                        .onTapGesture { withAnimation(.snappy) { selected = release } }
                }
                .listStyle(.sidebar)
                .frame(width: 210)

                Divider()

                Group {
                    if let release = selected ?? updates.releases.first {
                        Detail(release: release, updates: updates)
                    } else {
                        ContentUnavailableView("No releases yet",
                                               systemImage: "shippingbox",
                                               description: Text("Check again, or open the repository."))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 780, height: 540)
        .background(Backdrop())
        .task { if updates.releases.isEmpty { await updates.check() } }
    }
}

private struct Row: View {
    let release: Release
    let current: Version

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(release.tagName).font(.system(.callout, design: .monospaced))
                if let date = release.publishedAt {
                    Text(date.formatted(date: .abbreviated, time: .omitted))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 0)
            if release.version == current {
                Text("current").font(.caption2).foregroundStyle(.secondary)
            } else if current < release.version {
                Image(systemName: "arrow.up.circle.fill").foregroundStyle(.tint).font(.caption)
            }
        }
        .padding(.vertical, 2)
    }
}

private struct Detail: View {
    let release: Release
    @ObservedObject var updates: Updates

    private var direction: String {
        if release.version == updates.current { return "This is the version you are running." }
        return updates.current < release.version ? "Newer than yours." : "Older than yours."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text(release.title)
                    .font(.system(.headline, design: .rounded))
                    .textSelection(.enabled)
                Text(direction).font(.caption).foregroundStyle(.secondary)
            }
            .padding(20)

            ScrollView {
                Text(changelog)
                    .font(.system(size: 12))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
            }

            if release.version != updates.current {
                VStack(alignment: .leading, spacing: 10) {
                    Divider()
                    let command = updates.command(for: release)
                    Text(command)
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .glassEffect(.regular, in: .rect(cornerRadius: 10))

                    HStack(spacing: 10) {
                        Button {
                            updates.runInTerminal(command)
                        } label: {
                            Label(updates.current < release.version ? "Update" : "Downgrade",
                                  systemImage: updates.current < release.version ? "arrow.up" : "arrow.down")
                        }
                        .buttonStyle(.glass)

                        Button("Copy command") { updates.copy(command) }.buttonStyle(.glass)
                        Spacer(minLength: 0)
                        Button("Release notes") { updates.open(release) }.buttonStyle(.glass)
                    }

                    // Said plainly rather than buried: this app does not replace
                    // itself, and the reason is that it cannot do it safely.
                    Text(note)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(20)
            }
        }
    }

    private var changelog: String {
        guard let body = release.body, !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "This release has no notes."
        }
        return body
    }

    private var note: String {
        switch updates.install {
        case .homebrew:
            "Homebrew verifies the download's checksum before replacing anything. The app will quit while it does."
        case .elsewhere:
            "This copy was not installed by Homebrew. `brew install --cask nurkamol/seo-audit/seo-audit` takes it "
            + "over, or use the release notes to download it by hand — this app will not replace itself, because "
            + "an unsigned application that rewrites its own bundle is indistinguishable from something you would "
            + "not want."
        }
    }
}
