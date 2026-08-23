# The Homebrew cask.
#
#   brew tap nurkamol/seo-audit https://github.com/nurkamol/seo-audit
#   brew install --cask seo-audit
#
# `version` and `sha256` are rewritten by .github/workflows/mac-release.yml when
# a tag is pushed, so this file is never edited by hand and can never describe a
# build that does not exist.
cask "seo-audit" do
  version "1.21.0"
  sha256 :no_check

  url "https://github.com/nurkamol/seo-audit/releases/download/v#{version}/seo-audit-#{version}-macos.zip"
  name "seo-audit"
  desc "Crawl a site's sitemap and check every page, from a window"
  homepage "https://github.com/nurkamol/seo-audit"

  depends_on macos: ">= :tahoe"

  app "seo-audit.app"

  # The build is ad-hoc signed rather than notarised, so macOS quarantines it on
  # download. This is the same thing you would do by hand in the Finder, said
  # out loud instead.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/seo-audit.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Preferences/com.nurkamol.seo-audit.plist",
    "~/Library/Saved Application State/com.nurkamol.seo-audit.savedState",
  ]
end
