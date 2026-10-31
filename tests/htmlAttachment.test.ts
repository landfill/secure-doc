import test from "node:test";
import assert from "node:assert/strict";
import { analyzeHtmlAttachment } from "../src/shared/htmlAttachment.ts";
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
