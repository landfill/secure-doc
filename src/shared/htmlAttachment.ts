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
