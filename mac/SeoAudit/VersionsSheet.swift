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
                HStack(spacing: 8) {
                    Label(problem, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    // A dead end is not a message. Whatever went wrong, the
                    // releases page still answers.
                    Button("Open releases") { Links.open(Links.releases) }
                        .buttonStyle(.glass)
                        .controlSize(.small)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 8)
            } else if updates.listIsPartial {
                // Said rather than hidden: the feed does not mark prereleases,
                // so this list is shown but is not answering "is there an
                // update". A missing caveat reads exactly like no caveat.
                Label("Read from the releases feed, which does not mark prereleases — "
                      + "check the release notes before moving to the newest one.",
                      systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
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
                        ContentUnavailableView("No releases to show",
                                               systemImage: "shippingbox",
                                               description: Text("GitHub did not answer. Try Check now, "
                                                                 + "or open the releases page."))
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
                    // Absent for an older release: Homebrew has one cask and it
                    // tracks the latest, so it can move forward and not back.
                    if let command = updates.command(for: release) {
                        Text(command)
                            .font(.system(size: 11, design: .monospaced))
                            .textSelection(.enabled)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .glassEffect(.regular, in: .rect(cornerRadius: Radius.control))
                    }

                    HStack(spacing: 10) {
                        switch updates.upgradeState {
                        case .running(let line):
                            ProgressView().controlSize(.small)
                            Text(line)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        case .done:
                            Label("Installed", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                                .font(.callout)
                            Button("Relaunch") { updates.relaunch() }.buttonStyle(.glassProminent)
                        default:
                            if let command = updates.command(for: release) {
                                Button {
                                    Task { await updates.upgrade(release) }
                                } label: {
                                    Label("Update", systemImage: "arrow.up")
                                }
                                .buttonStyle(.glass)

                                Button("Run in Terminal") { updates.runInTerminal(command) }.buttonStyle(.glass)
                                Button("Copy") { updates.copy(command) }.buttonStyle(.glass)
                            } else {
                                // An older release: the zip is the only route,
                                // and it works for any version.
                                Button {
                                    Task { await updates.download(release) }
                                } label: {
                                    Label("Download \(release.version.description)", systemImage: "arrow.down")
                                }
                                .buttonStyle(.glass)
                            }
                        }
                        Spacer(minLength: 0)
                        Button("Release notes") { updates.open(release) }.buttonStyle(.glass)
                    }

                    if case .failed(let why) = updates.upgradeState {
                        Text(why)
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    // Said plainly rather than buried: Homebrew does the
                    // replacing, and this runs it rather than replacing the
                    // bundle behind its back.
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
            "Homebrew runs here rather than in Terminal, and it verifies the download against the checksum the "
            + "build wrote before replacing anything. Relaunching afterwards is what makes the new version the "
            + "one on screen."
        case .elsewhere:
            "This copy was not installed by Homebrew. `brew install --cask nurkamol/seo-audit/seo-audit` takes it "
            + "over, or use the release notes to download it by hand — this app will not replace itself, because "
            + "an unsigned application that rewrites its own bundle is indistinguishable from something you would "
            + "not want."
        }
    }
}
