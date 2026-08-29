# The Homebrew cask.
#
#   brew tap nurkamol/seo-audit https://github.com/nurkamol/seo-audit
#   brew install --cask seo-audit
#
# `version` and `sha256` are rewritten by .github/workflows/mac-release.yml when
# a tag is pushed, so this file is never edited by hand and can never describe a
# build that does not exist.
cask "seo-audit" do
  version "1.38.1"
  sha256 "f1ce47dace1edecef143143f27e50f94dcd068b621e86affdc0ed39d4457eeb1"

  # `verified` says the download really does come from this project's own
  # repository, which is what stops Homebrew warning that the URL and the
  # homepage are different hosts.
  url "https://github.com/nurkamol/seo-audit/releases/download/v#{version}/seo-audit-#{version}-macos.zip",
      verified: "github.com/nurkamol/seo-audit/"
  name "SEO Audit"
  desc "Crawl a site's sitemap and check every page, from a window"
  homepage "https://github.com/nurkamol/seo-audit"

  # Apple Silicon only: the release is built on an arm64 runner and carries an
  # arm64 Node. A universal build would be two Nodes and 216 MB.
  depends_on macos: :tahoe
  depends_on arch: :arm64

  # The token stays seo-audit; the app on disk is what people read.
  app "SEO Audit.app"

  # The build is ad-hoc signed rather than notarised, so macOS quarantines
  # anything downloaded and Gatekeeper refuses to open it. Clearing the flag is
  # exactly what right-click → Open does in the Finder; doing it here means the
  # app opens the first time instead of after a detour through a scary dialog.
  #
  # Homebrew has verified the checksum in this file before this runs, and that
  # checksum was written by the workflow that built the app. That chain is the
  # reason this is reasonable rather than reckless.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/SEO Audit.app"],
                   sudo: false
  end

  caveats <<~EOS
    seo-audit is ad-hoc signed rather than notarised, so macOS would normally
    refuse to open it. Homebrew checked the download against a checksum written
    by the build that produced it, and then cleared the quarantine flag — the
    same thing right-click → Open does, without the dialog.

    Notarising it needs an Apple Developer account, which this project does not
    have. Building it yourself is the alternative: ./mac/build.sh
  EOS

  zap trash: [
    "~/Library/Preferences/com.nurkamol.seo-audit.plist",
    "~/Library/Saved Application State/com.nurkamol.seo-audit.savedState",
  ]
end
