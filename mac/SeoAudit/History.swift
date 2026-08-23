// The sites this machine has audited, and the way out to everything else.
// A window can remember; a command cannot, and that is most of what a window is
// for here.

import SwiftUI

struct Sidebar: View {
    @ObservedObject var library: Library
    @ObservedObject var updates: Updates
    @Binding var showingVersions: Bool
    var reopen: (StoredReport) -> Void
    var again: (String) -> Void

    var body: some View {
        List {
            Section("Reports") {
                if library.reports.isEmpty {
                    Text("Audits you run are kept here, so a seven-minute crawl only happens once.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 6)
                } else {
                    ForEach(library.reports) { stored in
                        Button { reopen(stored) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 6) {
                                    Text(stored.host).lineLimit(1)
                                    if stored.errors > 0 {
                                        Text("\(stored.errors)")
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(.red)
                                    }
                                }
                                Text("\(stored.finishedAt.formatted(date: .abbreviated, time: .shortened)) · \(stored.summary)")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Audit again") { again(stored.site) }
                            Button("Delete", role: .destructive) {
                                withAnimation(.snappy) { library.forget(stored) }
                            }
                        }
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                Button {
                    showingVersions = true
                } label: {
                    HStack(spacing: 6) {
                        if updates.available != nil {
                            Circle().fill(.tint).frame(width: 6, height: 6)
                            Text("Update available")
                        } else {
                            Image(systemName: "shippingbox")
                            Text("Version \(updates.current.description)")
                        }
                    }
                    .font(.caption)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                }
                .buttonStyle(.glass)

                HStack(spacing: 10) {
                    Button("Help") { Links.open(Links.site) }.buttonStyle(.link)
                    Text("·").foregroundStyle(.quaternary)
                    Button("GitHub") { Links.open(Links.repo) }.buttonStyle(.link)
                    Text("·").foregroundStyle(.quaternary)
                    Button("About") { NotificationCenter.default.post(name: .showAbout, object: nil) }
                        .buttonStyle(.link)
                }
                .font(.caption2)

                Text("Nothing leaves this machine")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
        }
    }
}
