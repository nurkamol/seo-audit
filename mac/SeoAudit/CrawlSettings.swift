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
    /// A string of your own, when none of the presets is the thing a host
    /// treats differently. Wins over the two menus above when it is set.
    @AppStorage("seo-audit.crawl.userAgent") var userAgent = ""

    /// Checks this person has decided to live with, as a comma-separated list
    /// because `@AppStorage` holds strings. Silencing is per-machine on purpose:
    /// a decision a whole team should share belongs in the config file the
    /// repository commits, not in one person's preferences.
    @AppStorage("seo-audit.crawl.ignored") private var ignoredList = ""

    var ignored: [String] {
        get { ignoredList.split(separator: ",").map(String.init).filter { !$0.isEmpty } }
        set { ignoredList = Set(newValue).sorted().joined(separator: ",") }
    }

    func silence(_ id: String) { ignored = ignored + [id] }
    func unsilence(_ id: String) { ignored = ignored.filter { $0 != id } }
    func isSilenced(_ id: String) -> Bool { ignored.contains(id) }

    // --- PageSpeed ----------------------------------------------------------
    /// Performance is the one thing this tool refuses to estimate. `--psi` asks
    /// Google for Google's own measurement, which is the only honest way a
    /// window will ever show it — and each target is seconds of waiting, which
    /// is why it is off by default and sampled when on.
    enum Performance: String, CaseIterable, Identifiable {
        case off, homepage, sample

        var id: String { rawValue }

        var label: String {
            switch self {
            case .off: "Off"
            case .homepage: "Home page"
            case .sample: "A sample"
            }
        }

        /// What `--psi` is given. Empty means the flag is not passed at all.
        var targets: [String] {
            switch self {
            case .off: []
            case .homepage: ["/"]
            case .sample: ["/**"]
            }
        }
    }

    @AppStorage("seo-audit.psi.mode") var performance: Performance = .off
    @AppStorage("seo-audit.psi.sample") var performanceSample = 3
    @AppStorage("seo-audit.psi.desktop") var performanceOnDesktop = false

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
            // Always: rebuilding it needs per-page data that is gone by the
            // time the report arrives, and it costs one already-cached request.
            URLQueryItem(name: "sitemap-out", value: "1"),
        ]
        if speed != .normal {
            items.append(.init(name: "concurrency", value: String(speed.connections)))
        }
        if checkExternal { items.append(.init(name: "external", value: "1")) }
        let ownAgent = userAgent.trimmingCharacters(in: .whitespaces)
        if !ownAgent.isEmpty {
            items.append(.init(name: "userAgent", value: ownAgent))
        } else {
            if !browser.isEmpty { items.append(.init(name: "browser", value: browser)) }
            if !system.isEmpty { items.append(.init(name: "os", value: system)) }
        }
        let trimmed = sitemap.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty { items.append(.init(name: "sitemap", value: trimmed)) }

        if !ignored.isEmpty { items.append(.init(name: "ignore", value: ignored.joined(separator: ","))) }

        if performance != .off {
            items.append(.init(name: "psi", value: performance.targets.joined(separator: ",")))
            if performance == .sample {
                items.append(.init(name: "psi-sample", value: String(performanceSample)))
            }
            if performanceOnDesktop { items.append(.init(name: "psi-strategy", value: "desktop")) }
        }
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

                TextField("User agent", text: $settings.userAgent,
                          prompt: Text("Or a string of your own"))
                    .textFieldStyle(.roundedBorder)
                    .labelsHidden()
                Text("Overrides the two menus above when it is set. For an agent a host is known to "
                     + "treat differently, or a name of your own so your crawls are identifiable in "
                     + "somebody's logs.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } header: {
                Text("Identify as")
            }

            Section {
                Picker("Measure", selection: $settings.performance) {
                    ForEach(CrawlSettings.Performance.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                if settings.performance == .sample {
                    Stepper(value: $settings.performanceSample, in: 1...10) {
                        LabeledContent("Pages") {
                            Text("\(settings.performanceSample)").monospacedDigit()
                        }
                    }
                }
                if settings.performance != .off {
                    Toggle("Measure as a desktop browser", isOn: $settings.performanceOnDesktop)
                }
                Text("Google measures it, over its own network, in a real browser. This app never "
                     + "estimates performance — a plausible wrong number is worse than no number. "
                     + "Each page takes a few seconds, which is why it is sampled.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("A PageSpeed API key is optional and raises the quota. The engine reads "
                     + "PSI_API_KEY, or ~/.config/seo-audit/.env — the same two places the command "
                     + "line looks, so a key already set there is already working. This app never "
                     + "holds it.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .fixedSize(horizontal: false, vertical: true)
            } header: {
                Text("Performance")
            }

            Section {
                if settings.ignored.isEmpty {
                    Text("Nothing is silenced. Right-click a finding in a report to silence its "
                         + "check for future runs on this machine.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(settings.ignored, id: \.self) { id in
                        HStack {
                            Text(id).font(.system(.callout, design: .monospaced))
                            Spacer(minLength: 0)
                            Button("Stop silencing") { settings.unsilence(id) }
                                .buttonStyle(.glass)
                                .controlSize(.small)
                        }
                    }
                    Text("A report still says how many findings were silenced. A check that has been "
                         + "quietened must never read the same as one that passed.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            } header: {
                Text("Silenced checks")
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
