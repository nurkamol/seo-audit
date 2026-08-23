#!/usr/bin/env bash
# Build seo-audit.app.
#
# No Xcode project, on purpose: this needs swiftc and the command line tools and
# nothing else, so anyone who clones the repository can build it. There is no
# second copy of any check here — the app is a window over `bin/seo-audit.mjs`,
# and this script puts that CLI and a Node to run it inside the bundle.
#
#   ./mac/build.sh              build, ad-hoc signed, Node inside (~109 MB)
#   ./mac/build.sh --no-node    use the Node already on the machine (~2 MB)
#   ./mac/build.sh --run        build and open it
#   NODE_BIN=/path ./mac/build.sh    bundle a particular Node
#
# The size is one file: Node is 108 MB of the bundle and everything this project
# wrote is under one. Bundled, it runs on a Mac with nothing installed and zips
# to about 36 MB. Unbundled, it is a 2 MB app for somebody who already has Node.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$here/build"
app="$out/seo-audit.app"
name="seo-audit"
version="$(node -p "require('$here/package.json').version" 2>/dev/null || echo 0.0.0)"

bundle_node=1
for arg in "$@"; do [ "$arg" = "--no-node" ] && bundle_node=0; done

# The Node that goes inside. Whatever is on PATH unless told otherwise; it has
# to match the app's architecture, and it has to be relocatable, which every
# official build is.
node_bin="${NODE_BIN:-$(command -v node || true)}"
if [ "$bundle_node" = 1 ] && [ ! -x "$node_bin" ]; then
  echo "No node found to bundle. Install one, set NODE_BIN, or pass --no-node."; exit 1
fi

echo "  building $name $version"
if [ "$bundle_node" = 1 ]; then
  echo "  bundling $("$node_bin" -v) from $node_bin"
else
  echo "  no node bundled — the app will use whatever is installed"
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

# --- the binary ------------------------------------------------------------
# Targeting macOS 26 rather than 27: Liquid Glass arrived in 26, and building
# against the newest SDK while deploying to the oldest system that has the API
# is the difference between "needs the beta" and "needs a current Mac".
swiftc -O \
  -target arm64-apple-macos26.0 \
  -o "$app/Contents/MacOS/$name" \
  "$here"/mac/SeoAudit/*.swift

# --- the engine ------------------------------------------------------------
if [ "$bundle_node" = 1 ]; then
  cp "$node_bin" "$app/Contents/Resources/node"
  chmod +x "$app/Contents/Resources/node"
fi
mkdir -p "$app/Contents/Resources/engine"
cp -R "$here/bin" "$here/src" "$here/worker" "$here/package.json" "$app/Contents/Resources/engine/"

# --- the icon --------------------------------------------------------------
# Drawn from the same mark the reports carry, at every size macOS asks for.
iconset="$out/icon.iconset"
rm -rf "$iconset"; mkdir -p "$iconset"
sips -s format png --resampleHeightWidth 1024 1024 "$here/docs/icon.png" \
  --out "$iconset/icon_512x512@2x.png" >/dev/null 2>&1 || true
for size in 16 32 128 256 512; do
  sips -s format png -z $size $size "$here/docs/icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  sips -s format png -z $((size*2)) $((size*2)) "$here/docs/icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$app/Contents/Resources/$name.icns"
rm -rf "$iconset"

# --- the manifest ----------------------------------------------------------
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundleDisplayName</key><string>seo-audit</string>
  <key>CFBundleIdentifier</key><string>com.nurkamol.seo-audit</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIconFile</key><string>$name</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT</string>
  <!-- The engine listens on the loopback address and the web view reads it.
       Nothing here talks to a plaintext host that is not this machine. -->
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST
plutil -lint "$app/Contents/Info.plist" >/dev/null

# --- signature -------------------------------------------------------------
# Ad-hoc: enough to run on the machine that built it, which is what building it
# yourself means. A Developer ID and notarisation are what shipping it to
# somebody else needs, and neither belongs in a repository.
codesign --force --deep --sign - "$app" 2>/dev/null
codesign --verify --deep --strict "$app" && echo "  signed (ad-hoc)"

echo "  built $app ($(du -sh "$app" | cut -f1))"
for arg in "$@"; do [ "$arg" = "--run" ] && open "$app"; done
exit 0
