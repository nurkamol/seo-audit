// Which area of the site a check belongs to.
//
// Its own module because two things need it and neither can import the other:
// `report.mjs` groups the HTML report by area, and `causes.mjs` puts the area
// into the JSON payload so a native client can group its own report the same
// way without carrying a second copy of this table in another language.

// --- Categories -------------------------------------------------------------
// Severity says how loudly to complain; a category says who fixes it. Thirty
// findings sorted only by severity is a list you read once. The same thirty
// under "Images" and "Multilingual" is a list somebody can divide up.
//
// Ordered by what a crawler hits first: whether the page can be indexed at all,
// then what it says, then what it links to, then everything else.
export const CATEGORIES = [
  'Indexability',
  'Content',
  'Links',
  'Redirects',
  'Images',
  'Social',
  'Structured data',
  'Multilingual',
  'Sitemap & robots',
  'Site & security',
  'Performance',
];

const CATEGORY_OF = {
  // Indexability
  noindex: 'Indexability', 'x-robots-noindex': 'Indexability', 'nofollow-page': 'Indexability',
  'page-status': 'Indexability', 'body-not-html': 'Indexability', unreachable: 'Indexability', 'nothing-crawlable': 'Indexability',
  'crawl-rate-limited': 'Indexability',
  'rate-limited': 'Indexability',
  'canonical-missing': 'Indexability', 'canonical-multiple': 'Indexability',
  'canonical-other': 'Indexability', 'canonical-dead': 'Indexability',
  'canonical-redirects': 'Indexability', 'soft-404': 'Indexability',
  'canonical-chain': 'Indexability', 'robots-conflict': 'Indexability',
  'canonical-noindex': 'Indexability', 'canonical-paginated': 'Indexability',

  // Content
  'title-missing': 'Content', 'title-long': 'Content', 'title-short': 'Content',
  'desc-missing': 'Content', 'desc-long': 'Content', 'desc-short': 'Content',
  'h1-missing': 'Content', 'h1-multiple': 'Content', 'heading-skip': 'Content',
  'thin-content': 'Content', 'duplicate-title': 'Content', 'duplicate-description': 'Content',
  'duplicate-content': 'Content', 'duplicate-content-not-checked': 'Content',
  'lang-missing': 'Content', 'charset-missing': 'Content', 'viewport-missing': 'Content',
  'viewport-locked': 'Content', 'viewport-fixed-width': 'Content',

  // Links
  'broken-link': 'Links', 'orphan-page': 'Links', 'no-editorial-links': 'Links',
  'deep-page': 'Links', 'deep-page-more': 'Links', 'no-path-from-home': 'Links',
  'click-depth-skipped': 'Links', 'orphan-check-skipped': 'Links', 'link-no-text': 'Links', 'link-no-text-more': 'Links',
  'anchor-generic': 'Links', 'anchor-generic-more': 'Links',
  'anchor-ambiguous': 'Links', 'anchor-ambiguous-more': 'Links',
  'link-redirects': 'Links', 'link-sweep-capped': 'Links', 'internal-nofollow': 'Links',
  'missing-from-sitemap': 'Links', 'missing-from-sitemap-more': 'Links',
  'external-broken': 'Links', 'external-redirects': 'Links', 'external-sweep-capped': 'Links',

  // Redirects
  'sitemap-redirect': 'Redirects', 'redirect-chain': 'Redirects', 'host-variant-dead': 'Redirects',
  'host-variant-not-checked': 'Redirects',
  'origin-redirected': 'Redirects',
  'serves-differently': 'Indexability', 'compare-sampled': 'Indexability',
  'search-console': 'Site & security', 'search-console-unconfigured': 'Site & security',
  'search-console-failed': 'Site & security',
  'trailing-slash': 'Redirects', 'meta-refresh': 'Redirects',
  'redirect-dead': 'Redirects', 'redirect-broken': 'Redirects',
  'redirect-not-applied': 'Redirects', 'redirect-hops': 'Redirects',
  'redirect-elsewhere': 'Redirects', 'redirect-temporary': 'Redirects',
  'redirect-pattern-skipped': 'Redirects', 'redirect-map-capped': 'Redirects',

  // Images
  'img-alt': 'Images', 'img-alt-filename': 'Images', 'img-alt-placeholder': 'Images',
  'img-alt-duplicate': 'Images', 'img-alt-long': 'Images', 'img-dimensions': 'Images',
  'img-srcset': 'Images', 'broken-image': 'Images', 'image-sweep-capped': 'Images',
  'img-title-duplicates-alt': 'Images', 'img-title-on-decorative': 'Images',
  'img-lazy-priority': 'Images',

  // Social
  'og-title-missing': 'Social', 'og-description-missing': 'Social',
  'og-image-missing': 'Social', 'og-webp': 'Social', 'og-no-dimensions': 'Social',
  'og-image-relative': 'Social', 'og-image-broken': 'Social', 'og-image-heavy': 'Social',

  // Structured data
  'jsonld-invalid': 'Structured data', 'jsonld-no-type': 'Structured data',
  'schema-expected': 'Structured data', 'schema-incomplete': 'Structured data',
  'schema-date-order': 'Structured data', 'schema-date-future': 'Structured data',
  'schema-image-broken': 'Structured data',

  // Multilingual
  'hreflang-one-way': 'Multilingual', 'hreflang-no-self': 'Multilingual',
  'hreflang-lang-mismatch': 'Multilingual', 'hreflang-invalid': 'Multilingual',
  'hreflang-no-x-default': 'Multilingual', 'hreflang-dead': 'Multilingual',
  'content-language-mismatch': 'Multilingual',

  // Sitemap & robots
  'no-sitemap': 'Sitemap & robots', truncated: 'Sitemap & robots',
  // What the run was told to leave out. Facts about the crawl rather than
  // about the site, and they sit beside `truncated` for that reason.
  since: 'Sitemap & robots', 'since-not-usable': 'Sitemap & robots',
  excluded: 'Sitemap & robots',
  'sitemap-not-checked': 'Sitemap & robots',
  'rate-limit-slowed': 'Sitemap & robots',
  'robots-missing': 'Sitemap & robots', 'robots-blocks-all': 'Sitemap & robots',
  'robots-no-sitemap': 'Sitemap & robots', 'robots-blocks-sitemap-url': 'Sitemap & robots',
  'sitemap-lastmod-missing': 'Sitemap & robots', 'sitemap-lastmod-identical': 'Sitemap & robots',
  'sitemap-lastmod-future': 'Sitemap & robots', 'llms-missing': 'Sitemap & robots',
  'sitemap-duplicate-url': 'Sitemap & robots',
  'sitemap-not-indexable': 'Sitemap & robots', 'sitemap-too-many-urls': 'Sitemap & robots',
  'sitemap-too-large': 'Sitemap & robots',

  // Site & security
  'favicon-broken': 'Site & security', 'favicon-missing': 'Site & security',
  'mixed-content': 'Site & security', 'tls-not-checked': 'Site & security',
  // The note the hosted Worker leaves where the certificate checks would
  // have been. It belongs beside them, not in Other.
  'tls-expiring': 'Site & security',
  'tls-expired': 'Site & security', 'url-uppercase': 'Site & security',
  'url-underscore': 'Site & security', 'url-space': 'Site & security',
  'header-strict-transport-security': 'Site & security',
  'header-x-content-type-options': 'Site & security',
  'header-referrer-policy': 'Site & security',
  'header-content-security-policy': 'Site & security',

  // Performance
  slow: 'Performance', uncompressed: 'Performance', 'huge-html': 'Performance', 'psi-score': 'Performance', 'psi-lcp': 'Performance',
  'psi-cls': 'Performance', 'psi-inp': 'Performance', 'psi-opportunity': 'Performance',
  'psi-failed': 'Performance', 'psi-no-field-data': 'Performance',
  'psi-field-lcp': 'Performance', 'psi-field-cls': 'Performance', 'psi-field-inp': 'Performance',
  'psi-sampled': 'Performance', 'psi-no-match': 'Performance',
};

/** The category a check belongs to. Unknown ids fall to "Other" rather than
 *  disappearing — and a test asserts nothing in src/ ever lands there. */
export const categoryOf = (id) => CATEGORY_OF[id] ?? 'Other';
