export const MAX_HTML_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface HtmlAttachmentAnalysis {
  hasScripts: boolean;
  hasExternalResources: boolean;
}

const SCRIPT_PATTERN = /<script\b|\son[a-z]+\s*=|javascript:/i;
const EXTERNAL_RESOURCE_PATTERN =
  /<(?:img|script|link|iframe|source|video|audio|embed|object)\b[^>]*\s(?:src|href|srcset|data)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|@import\s+["']?\s*(?:https?:)?\/\//i;

// Heuristic warnings shown before publishing. The sandboxed viewer blocks these
// regardless; the checks only tell the issuer which parts will not work.
export function analyzeHtmlAttachment(html: string): HtmlAttachmentAnalysis {
  return {
    hasScripts: SCRIPT_PATTERN.test(html),
    hasExternalResources: EXTERNAL_RESOURCE_PATTERN.test(html)
  };
}

// The admin app has no page CSP, and a sandboxed srcdoc frame still loads
// images, stylesheets, and fonts. The preview copy gets its own CSP so that
// selecting a file never contacts external servers. The encrypted attachment
// is not modified; the viewer's own CSP covers it.
export const ATTACHMENT_PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:"
].join("; ");

const LEADING_DOCTYPE = /^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i;

export function withAttachmentPreviewCsp(html: string): string {
  const doctype = html.match(LEADING_DOCTYPE)?.[0] ?? "";
  const meta = `<meta http-equiv="Content-Security-Policy" content="${ATTACHMENT_PREVIEW_CSP}">`;
  return doctype + meta + html.slice(doctype.length);
}

const META_CHARSET = /<meta\b[^>]*?charset\s*=\s*["']?\s*([a-z0-9_.:-]+)/i;

function sniffHtmlEncoding(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";

  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  const declared = head.match(META_CHARSET)?.[1].toLowerCase();
  // A meta tag cannot declare UTF-16 for ASCII-compatible bytes; browsers treat it as UTF-8.
  if (!declared || /^(?:utf-?16|unicode)/.test(declared)) return "utf-8";
  return declared;
}

// Decodes an HTML file using its BOM or <meta charset>, defaulting to UTF-8.
// Returns null instead of publishing mojibake when the bytes do not decode.
export function decodeHtmlAttachment(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder(sniffHtmlEncoding(bytes), { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
