// A crawler signature: the store owner's own permission for this crawl.
//
// Since 30 May 2026 Shopify gives unsigned crawlers its strictest limits, and
// nothing about how a crawl behaves gets a full product crawl through them —
// one request a second is still refused. The sanctioned way past is Web Bot
// Auth: the store's owner creates a signature in their admin (Online Store →
// Preferences → Crawler access), copies two values, and every request carries
// them along with a fixed third. It is the store saying "let this one in",
// which is the only kind of getting past bot protection this tool does.
//
// The values are static — copied once and sent unchanged for up to three
// months — so they are a credential, and treated as one: read from a file the
// person controls, sent to the one origin they were made for and nowhere else,
// and never written into a report, a log line or a kept run.
//
// Web-standard only. The reading of files happens in config.mjs, so this can
// be used wherever the audit runs.

/** The third header. Shopify documents it as a fixed value, quotes included. */
export const SIGNATURE_AGENT = '"https://shopify.com"';

const NAMES = { 'signature-input': 'Signature-Input', signature: 'Signature', 'signature-agent': 'Signature-Agent' };

/**
 * The headers in a signature file, and when they stop working.
 *
 * The file is the two values as the admin's Copy buttons give them, each on a
 * line with its name:
 *
 *     Signature-Input: sig1=("@authority" "signature-agent");created=…;expires=…;keyid="…";tag="web-bot-auth"
 *     Signature: sig1=:…:
 *
 * `Signature-Agent` may be given and is supplied when it is not. Blank lines
 * and `#` comments are ignored, so the file can say what it is for.
 *
 * Throws with a sentence somebody can act on, because a signature that is
 * quietly not sent looks exactly like one that was refused.
 *
 * @returns {{ headers: Record<string, string>, expires: Date | null }}
 */
export function parseSignature(text) {
  const headers = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    const name = NAMES[line.slice(0, colon).trim().toLowerCase()];
    if (colon < 1 || !name) {
      throw new Error(
        `"${line.slice(0, 40)}${line.length > 40 ? '…' : ''}" is not a line this file can hold — ` +
          'expected Signature-Input: and Signature:, each followed by the value copied from Shopify.',
      );
    }
    headers[name] = line.slice(colon + 1).trim();
  }

  if (!headers['Signature-Input'] || !headers.Signature) {
    const missing = ['Signature-Input', 'Signature'].filter((n) => !headers[n]).join(' and ');
    throw new Error(`The signature file has no ${missing}. Both values have to be copied from the Shopify admin.`);
  }
  // Shapes from RFC 9421, checked loosely: enough to catch a value that was
  // copied short or pasted into the wrong line, which is the usual failure.
  if (!/^[A-Za-z0-9_-]+=\(/.test(headers['Signature-Input'])) {
    throw new Error('Signature-Input does not look like one — it should begin like sig1=( … . Was it copied whole?');
  }
  if (!/^[A-Za-z0-9_-]+=:[A-Za-z0-9+/=_-]+:$/.test(headers.Signature)) {
    throw new Error('Signature does not look like one — it should look like sig1=:…: . Was it copied whole?');
  }
  headers['Signature-Agent'] ??= SIGNATURE_AGENT;

  const expires = headers['Signature-Input'].match(/;\s*expires=(\d+)/)?.[1];
  return { headers, expires: expires ? new Date(Number(expires) * 1000) : null };
}

/** Whether a parsed signature can still be used, and a sentence saying so.
 *  Never includes the values themselves. */
export function signatureState(signature, now = new Date()) {
  if (!signature?.expires) return { expired: false, days: null };
  const days = Math.floor((signature.expires.getTime() - now.getTime()) / 86_400_000);
  return { expired: signature.expires.getTime() <= now.getTime(), days };
}
