// swift-tools-version: 6.0
//
// Here so the macOS app opens in Xcode without an .xcodeproj — Xcode reads a
// package directly, and `swift build` works from a terminal. It does not build
// the .app: a package produces an executable, and mac/build.sh is what wraps
// that in a bundle with its icon, its Info.plist and its engine.
//
// The CLI itself is not a Swift target and never will be. It is Node, it has no
// dependencies, and `npx github:nurkamol/seo-audit` is the whole install.
import PackageDescription

let package = Package(
    name: "seo-audit",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(name: "SeoAudit", path: "mac/SeoAudit")
    ]
)
