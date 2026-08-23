// Where this app keeps things between launches.
//
// One function because there were briefly two answers: the report library wrote
// to `seo-audit` and the version cache to `SEO Audit`, so an app with one name
// had two folders and neither was obviously the real one. The folder is named
// for the bundle id's last component rather than for the display name — the
// display name is for people, and it has already changed once.

import Foundation

enum Support {
    /// `~/Library/Application Support/seo-audit`, created if it is not there.
    /// Application Support rather than Caches: the system may empty Caches, and
    /// seven minutes of crawling is not a cache.
    static func directory(_ root: URL? = nil) -> URL {
        let base = root ?? FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("seo-audit", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }
}
