// The releases, read from GitHub's Atom feed instead of its API.
//
// api.github.com allows sixty anonymous requests an hour per address, and that
// budget is shared with every other tool on the machine that talks to GitHub —
// so a 403 while opening a Versions sheet is ordinary, not exceptional. The
// same releases are published at github.com/<owner>/<repo>/releases.atom, which
// is served by a different host and does not spend that quota.
//
// What the feed cannot say is whether a release is a prerelease. Everything
// parsed here is therefore marked `fromFeed`, and `Updates.available` refuses
// to announce an update from a feed-sourced list — showing somebody a version
// is useful, pushing them onto a prerelease because the feed did not mention it
// is not.
//
// `XMLParser` rather than a regex, and rather than a package: Atom is XML, the
// parser is in Foundation, and this project does not take dependencies.

import Foundation

enum AtomReleases {
    static func parse(_ data: Data) -> [Release] {
        let collector = Collector()
        let parser = XMLParser(data: data)
        parser.delegate = collector
        guard parser.parse() else { return [] }
        return collector.releases
    }

    /// Accumulates one `<entry>` at a time. Atom nests `<link>` and `<title>`
    /// inside `<feed>` as well as inside each `<entry>`, so everything is
    /// ignored until an entry opens.
    private final class Collector: NSObject, XMLParserDelegate {
        var releases: [Release] = []

        private var inEntry = false
        private var element = ""
        private var text = ""
        private var title = ""
        private var content = ""
        private var updated = ""
        private var href = ""
        private var id = ""

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                    qualifiedName: String?, attributes: [String: String] = [:]) {
            if name == "entry" {
                inEntry = true
                title = ""; content = ""; updated = ""; href = ""; id = ""
            }
            element = name
            text = ""
            // A release entry carries several links; the one that goes to a
            // human is the alternate.
            if inEntry, name == "link", attributes["rel"] ?? "alternate" == "alternate" {
                href = attributes["href"] ?? href
            }
        }

        func parser(_ parser: XMLParser, foundCharacters found: String) { text += found }

        // GitHub wraps the release notes in CDATA, which arrives here instead.
        func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
            text += String(data: CDATABlock, encoding: .utf8) ?? ""
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?,
                    qualifiedName: String?) {
            defer { text = "" }
            guard inEntry else { return }
            switch name {
            case "title": title = text.trimmingCharacters(in: .whitespacesAndNewlines)
            case "content": content = text
            case "updated": updated = text.trimmingCharacters(in: .whitespacesAndNewlines)
            case "id": id = text.trimmingCharacters(in: .whitespacesAndNewlines)
            case "entry":
                inEntry = false
                guard let tag = tagName() else { return }
                releases.append(Release(
                    tagName: tag,
                    name: title.isEmpty ? nil : title,
                    body: plainText(content),
                    publishedAt: ISO8601DateFormatter().date(from: updated),
                    htmlUrl: href.isEmpty
                        ? "https://github.com/nurkamol/seo-audit/releases/tag/\(tag)"
                        : href,
                    prerelease: false,
                    fromFeed: true,
                ))
            default: break
            }
        }

        /// The tag is the last path component of the alternate link, and the
        /// `<id>` says the same thing when there is no link. An entry with
        /// neither is dropped rather than guessed at — a release with no version
        /// cannot be ordered, and an unorderable row is worse than a missing one.
        private func tagName() -> String? {
            let candidate = href.isEmpty ? id : href
            guard let last = candidate.split(separator: "/").last.map(String.init),
                  !last.isEmpty, last.contains(where: \.isNumber)
            else { return nil }
            return last
        }
    }

    /// The notes as text, because that is what the sheet draws. GitHub's
    /// rendered HTML is generated markup, so this stays deliberately narrow:
    /// block tags become newlines, list items get a bullet, everything else is
    /// dropped, and the five XML entities are put back.
    static func plainText(_ html: String) -> String {
        guard !html.isEmpty else { return "" }
        var out = html
        for (pattern, replacement) in [
            ("(?i)<li[^>]*>", "\n• "),
            // `li` is not in this list: the opening tag above already starts
            // its line, and closing it too would put a blank line between
            // every pair of bullets.
            ("(?i)</(p|div|h[1-6]|ul|ol|pre|blockquote|tr)>", "\n"),
            ("(?i)<br\\s*/?>", "\n"),
            ("<[^>]+>", ""),
        ] {
            out = out.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        // `&amp;` last, so an escaped entity in the notes does not decode twice.
        for (entity, character) in [("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""),
                                    ("&#39;", "'"), ("&nbsp;", " "), ("&amp;", "&")] {
            out = out.replacingOccurrences(of: entity, with: character)
        }
        return out
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
