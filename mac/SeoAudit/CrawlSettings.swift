// What a run does, when somebody has a reason to change it.
//
// The window used to offer a URL and a page limit, and everything else the
// engine can do was reachable only from the command line. The one that made
// this worth building is speed: a store that answers 429 gets crawled at one
// connection and does not at six, and from a window there was no way to say so.
//
// Only settings that change the *result* live here. Where reports are kept and
// whether to check for updates are already answered by the Library and Versions
// sheets, and a preference that duplicates a screen is a second place to look.

import SwiftUI

@MainActor
final class CrawlSettings: ObservableObject {
    /// How hard to crawl. Named rather than numbered, because "6" is not a
    /// thing anybody knows they want — "this site keeps refusing me" is.
    enum Speed: String, CaseIterable, Identifiable {
        case gentle, normal, fast

        var id: String { rawValue }

        var connections: Int {
            switch self {
            case .gentle: 1
            case .normal: 6
            case .fast: 12
            }
        }

        var label: String {
            switch self {
            case .gentle: "Gentle"
            case .normal: "Normal"
            case .fast: "Fast"
            }
        }

        var detail: String {
            switch self {
            case .gentle: "One request at a time. Slow, and the setting that gets through a site answering 429."
            case .normal: "Six at a time. What the command line does by default."
            case .fast: "Twelve at a time. Only for a site you own, or one you know can take it."
            }
        }
    }

    @AppStorage("seo-audit.crawl.speed") var speed: Speed = .normal
    @AppStorage("seo-audit.crawl.limit") var limit: Int = 200
    @AppStorage("seo-audit.crawl.checkExternal") var checkExternal = false
    /// Empty means "whatever this machine looks like", which is what the engine
    /// does when nothing is passed.
    @AppStorage("seo-audit.crawl.browser") var browser = ""
    @AppStorage("seo-audit.crawl.os") var system = ""
    @AppStorage("seo-audit.crawl.sitemap") var sitemap = ""

    /// The list of presets comes from the engine, so adding one to
    /// `src/agents.mjs` adds it to this menu and nothing here needs editing.
    @Published private(set) var browsers: [String] = []
    @Published private(set) var systems: [String] = []

    func loadAgents(from engine: URL?) async {
        guard let engine, browsers.isEmpty else { return }
        guard let (data, response) = try? await URLSession.shared.data(from: engine.appending(path: "agents")),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let list = try? JSONDecoder().decode(AgentList.self, from: data)
        else { return }
        browsers = list.browsers
        systems = list.systems
    }

    private struct AgentList: Decodable {
        let browsers: [String]
        let systems: [String]
    }

    /// Everything a run needs, as query items. Anything left at its default is
    /// omitted rather than sent explicitly, so the engine's defaults stay the
    /// defaults and there is one place they are written down.
    func queryItems(for run: Run) -> [URLQueryItem] {
        var items = [
            URLQueryItem(name: "url", value: run.url),
            URLQueryItem(name: "limit", value: String(run.limit)),
            URLQueryItem(name: "format", value: "json"),
        ]
        if speed != .normal {
            items.append(.init(name: "concurrency", value: String(speed.connections)))
        }
        if checkExternal { items.append(.init(name: "external", value: "1")) }
        if !browser.isEmpty { items.append(.init(name: "browser", value: browser)) }
        if !system.isEmpty { items.append(.init(name: "os", value: system)) }
        let trimmed = sitemap.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { items.append(.init(name: "sitemap", value: trimmed)) }
        return items
    }
}

struct SettingsScene: View {
    @ObservedObject var settings: CrawlSettings
    @EnvironmentObject private var engine: Engine

    private var title: String { "Crawl" }

    var body: some View {
        Form {
            Section {
                Picker("Speed", selection: $settings.speed) {
                    ForEach(CrawlSettings.Speed.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                Text(settings.speed.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } header: {
                Text("How hard to crawl")
            }

            Section {
                // The number belongs beside the control that changes it. As a
                // Stepper label it sat against the row's title on the far left
                // with the arrows an inch away, and read as part of the label.
                LabeledContent("Pages per run") {
                    HStack(spacing: 6) {
                        Text("\(settings.limit)").monospacedDigit()
                        Stepper("Pages per run", value: $settings.limit, in: 1...5000, step: 50)
                            .labelsHidden()
                    }
                }
                Text("A crawl that stops at its limit says so in the report, with the number it did not reach.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Toggle("Check outbound links", isOn: $settings.checkExternal)
                Text("Follows links to other sites to see whether they still resolve. Slower, and only a "
                     + "404, 410 or no answer is reported.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } header: {
                Text("How much to check")
            }

            Section {
                Picker("Browser", selection: $settings.browser) {
                    Text("This machine").tag("")
                    ForEach(settings.browsers, id: \.self) { Text($0).tag($0) }
                }
                Picker("System", selection: $settings.system) {
                    Text("This machine").tag("")
                    ForEach(settings.systems, id: \.self) { Text($0).tag($0) }
                }
                Text("Some sites answer a crawler differently from a browser. A combination that cannot "
                     + "exist — Safari on Windows — is refused by the engine and the run goes ahead as itself.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } header: {
                Text("Identify as")
            }

            Section {
                // As a TextField *title* this printed "Found automatically" as a
                // label beside an empty box, which reads as a setting that is
                // switched on. It is a placeholder: what happens when the field
                // is left alone.
                TextField("Sitemap URL",
                          text: $settings.sitemap,
                          prompt: Text("Found automatically"))
                    .textFieldStyle(.roundedBorder)
                    .labelsHidden()
                Text("Only used when a sitemap is somewhere the usual names do not find it. It has to be "
                     + "on the site being audited.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } header: {
                Text("Sitemap")
            }
        }
        .formStyle(.grouped)
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
        .task { await settings.loadAgents(from: engine.base) }
    }
}
