import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeHtmlAttachment,
  ATTACHMENT_PREVIEW_CSP,
  decodeHtmlAttachment,
  withAttachmentPreviewCsp
} from "../src/shared/htmlAttachment.ts";
import { issueSecureDocument, unlockSecureDocument, type SecureDocPlainContent } from "../src/shared/securePackage.ts";
import { buildSecureHtmlDocument, VIEWER_CSP } from "../src/shared/viewerHtml.ts";

const pin = "A9-zK2!mP4_q";
const attachedHtml = `<!doctype html>
<html><head><title>Board memo</title><style>.secret { color: #c00 }</style></head>
<body><p class="secret">attached-confidential-body</p><script>document.title = "ran"</script></body></html>`;

test("encrypts an attached HTML file as-is and keeps the plaintext out of the viewer", async () => {
  const content: SecureDocPlainContent = {
    type: "secure-doc-content",
    version: "1.0",
    format: "html-attachment",
    html: attachedHtml,
    assets: []
  };
  const pkg = await issueSecureDocument({
    content,
    pin,
    iterations: 1000,
    metadata: { id: "doc_20261031_attach", title: "Board memo", issuer: "HQ" }
  });

  const unlocked = await unlockSecureDocument(pin, pkg);
  assert.equal(unlocked.format, "html-attachment");
  assert.equal(unlocked.html, attachedHtml);

  const viewer = buildSecureHtmlDocument(pkg);
  assert.equal(viewer.includes("attached-confidential-body"), false);
  assert.equal(viewer.includes(".secret"), false);
});

test("viewer renders attachments only in a fully sandboxed srcdoc frame under the unchanged CSP", async () => {
  const pkg = await issueSecureDocument({
    content: { type: "secure-doc-content", version: "1.0", format: "html", html: "<p>body</p>", assets: [] },
    pin,
    iterations: 1000,
    metadata: { id: "doc_20261031_frame", title: "Frame", issuer: "HQ" }
  });
  const viewer = buildSecureHtmlDocument(pkg);

  const frames = viewer.match(/<iframe\b[^>]*>/g) ?? [];
  assert.equal(frames.length, 1);
  assert.match(frames[0], /\ssandbox=""/);
  assert.equal(/allow-/.test(frames[0]), false);
  assert.match(viewer, /attachmentFrame\.srcdoc = /);
  assert.match(VIEWER_CSP, /frame-src 'none'/);
  assert.match(VIEWER_CSP, /connect-src 'none'/);
});

test("flags scripts and external resources in attached HTML", () => {
  assert.deepEqual(analyzeHtmlAttachment("<p>plain</p><img src=\"data:image/png;base64,AA==\">"), {
    hasScripts: false,
    hasExternalResources: false
  });
  assert.equal(analyzeHtmlAttachment(attachedHtml).hasScripts, true);
  assert.equal(analyzeHtmlAttachment("<button onclick=\"go()\">x</button>").hasScripts, true);
  assert.equal(analyzeHtmlAttachment("<img src=\"https://cdn.example.com/a.png\">").hasExternalResources, true);
  assert.equal(analyzeHtmlAttachment("<link rel=\"stylesheet\" href=\"//cdn.example.com/a.css\">").hasExternalResources, true);
  assert.equal(analyzeHtmlAttachment("<style>body { background: url('https://x.test/bg.png') }</style>").hasExternalResources, true);
  assert.equal(analyzeHtmlAttachment("<a href=\"https://example.com\">link</a>").hasExternalResources, false);
});

test("preview copy gets a network-blocking CSP placed after the doctype", () => {
  const preview = withAttachmentPreviewCsp("<!DOCTYPE html>\n<html><head><link rel=\"stylesheet\" href=\"https://x.test/a.css\"></head></html>");
  assert.match(preview, /^<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; /);
  assert.equal(/https?:|connect-src|script-src/.test(ATTACHMENT_PREVIEW_CSP), false);

  const noDoctype = withAttachmentPreviewCsp("<p>body</p>");
  assert.equal(noDoctype.startsWith("<meta http-equiv=\"Content-Security-Policy\""), true);
  assert.equal(noDoctype.endsWith("<p>body</p>"), true);
});

test("decodes attached HTML using its BOM or declared charset", () => {
  const eucKrHead = new TextEncoder().encode("<html><head><meta charset=\"euc-kr\"></head><body><p>");
  const eucKr = new Uint8Array([...eucKrHead, 0xb0, 0xa1, ...new TextEncoder().encode("</p></body></html>")]);
  assert.match(decodeHtmlAttachment(eucKr) ?? "", /<p>가<\/p>/);

  const httpEquiv = new Uint8Array([
    ...new TextEncoder().encode("<meta http-equiv=\"Content-Type\" content=\"text/html; charset=EUC-KR\"><p>"),
    0xb0, 0xa1
  ]);
  assert.match(decodeHtmlAttachment(httpEquiv) ?? "", /<p>가$/);

  const utf8Bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<p>가</p>")]);
  assert.equal(decodeHtmlAttachment(utf8Bom), "<p>가</p>");

  const utf16le = new Uint8Array([0xff, 0xfe, ...Array.from("<p>가</p>").flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
  assert.equal(decodeHtmlAttachment(utf16le), "<p>가</p>");

  assert.equal(decodeHtmlAttachment(new TextEncoder().encode("<p>가</p>")), "<p>가</p>");
});

test("refuses to decode instead of publishing corrupted text", () => {
  const undeclaredEucKr = new Uint8Array([...new TextEncoder().encode("<p>"), 0xb0, 0xa1, ...new TextEncoder().encode("</p>")]);
  assert.equal(decodeHtmlAttachment(undeclaredEucKr), null);
  assert.equal(decodeHtmlAttachment(new TextEncoder().encode("<meta charset=\"no-such-charset\"><p>x</p>")), null);
});
