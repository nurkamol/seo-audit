// The sites this machine has audited, and the way out to everything else.
// A window can remember; a command cannot, and that is most of what a window is
// for here.

import SwiftUI

@MainActor
final class History: ObservableObject {
    @Published private(set) var sites: [String] = []
    private let key = "seo-audit.history"

    init() {
        sites = UserDefaults.standard.stringArray(forKey: key) ?? []
    }

    func remember(_ url: String) {
        // Most recent first, no duplicates, and a bound: this is a list to
        // click, not an archive.
        sites.removeAll { $0 == url }
        sites.insert(url, at: 0)
        sites = Array(sites.prefix(12))
        UserDefaults.standard.set(sites, forKey: key)
    }

    func forget(_ url: String) {
        sites.removeAll { $0 == url }
        UserDefaults.standard.set(sites, forKey: key)
    }
}

struct Sidebar: View {
    @ObservedObject var history: History
    @ObservedObject var updates: Updates
    @Binding var showingVersions: Bool
    var audit: (String) -> Void

    var body: some View {
        List {
            Section("Recent") {
                if history.sites.isEmpty {
                    Text("Sites you audit will appear here.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 6)
                } else {
                    ForEach(history.sites, id: \.self) { url in
                        Button { audit(url) } label: {
                            Label(URL(string: url)?.host ?? url, systemImage: "globe").lineLimit(1)
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button("Remove", role: .destructive) {
                                withAnimation(.snappy) { history.forget(url) }
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

                Text("Nothing leaves this machine")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
        }
    }
}
