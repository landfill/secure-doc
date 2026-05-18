import { PACKAGE_SCHEMA, PACKAGE_VERSION, PUBLIC_UNLOCK_ERROR, type SecureDocPackage } from "./securePackage.ts";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "./pinPolicy.ts";

export const VIEWER_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&]/g, (character) => {
    if (character === "<") return "\\u003c";
    if (character === ">") return "\\u003e";
    return "\\u0026";
  });
}

export function buildSecureHtmlDocument(securePackage: SecureDocPackage): string {
  const title = escapeHtml(securePackage.doc.title || "보안문서");
  const issuer = escapeHtml(securePackage.doc.issuer || "");
  const issuedAt = escapeHtml(securePackage.doc.issuedAt || "");
  const expiresAt = securePackage.doc.displayExpiresAt ? escapeHtml(securePackage.doc.displayExpiresAt) : "";
  const pinHelpText = `${PIN_MIN_LENGTH}자리 이상 ${PIN_MAX_LENGTH}자리 이내 PIN`;
  const packageJson = escapeJsonForScript(securePackage);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${VIEWER_CSP}">
  <title>${title}</title>
  <style>
    :root {
      color-scheme: light;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --bg: #fafaf9;
      --fg: #1c1b1a;
      --muted: #6b6964;
      --border: #e6e4e0;
      --border-control: #d4d0ca;
      --border-hover: #cbbcb3;
      --border-table: #d7deea;
      --accent: #c96442;
      --accent-soft: #fbefe9;
      --document-border: var(--accent);
      --surface: #ffffff;
      --on-accent: #ffffff;
      --bad: #b53a2a;
      background: var(--bg);
      color: var(--fg);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
    }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    header {
      padding: 28px min(7vw, 72px) 18px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    h1 {
      margin: 0 0 8px;
      font-size: clamp(24px, 3vw, 36px);
      letter-spacing: 0;
      line-height: 1.15;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
      color: var(--muted);
      font-size: 14px;
    }
    main {
      width: min(920px, calc(100% - 32px));
      margin: 0 auto;
      padding: 48px 0 64px;
    }
    .unlock {
      display: grid;
      gap: 18px;
      max-width: 440px;
    }
    .unlock h2 {
      margin: 0;
      font-size: 22px;
      letter-spacing: 0;
    }
    .unlock p, .status {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
    }
    label {
      display: grid;
      gap: 8px;
      font-weight: 700;
    }
    input {
      width: 100%;
      height: 48px;
      border: 1px solid var(--border-control);
      border-radius: 6px;
      padding: 0 14px;
      font: inherit;
      letter-spacing: 0;
      background: var(--surface);
    }
    button {
      width: fit-content;
      min-width: 132px;
      height: 44px;
      border: 0;
      border-radius: 6px;
      padding: 0 18px;
      font: inherit;
      font-weight: 700;
      color: var(--on-accent);
      background: var(--accent);
      cursor: pointer;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.66;
    }
    .error {
      min-height: 22px;
      color: var(--bad);
      font-weight: 700;
    }
    .document {
      display: none;
      position: relative;
      padding: 32px 0;
      line-height: 1.7;
      background: var(--surface);
      border-top: 4px solid var(--document-border);
      overflow: hidden;
      isolation: isolate;
    }
    .document-inner {
      position: relative;
      z-index: 1;
      width: min(820px, calc(100% - 40px));
      margin: 0 auto;
    }
    .document-inner h1 {
      color: var(--accent);
    }
    .document-inner h2 {
      border-left: 4px solid var(--accent);
      padding: 5px 0 5px 10px;
      color: var(--fg);
      background: var(--accent-soft);
    }
    .document-inner h3 {
      color: var(--fg);
    }
    .document-inner table {
      width: 100%;
      border-collapse: collapse;
    }
    .document-inner th, .document-inner td {
      border: 1px solid var(--border-table);
      padding: 8px 10px;
      text-align: left;
    }
    .document-inner img {
      max-width: 100%;
      height: auto;
    }
    .document-inner ul, .document-inner ol {
      padding-left: 24px;
    }
    .document-inner blockquote {
      margin: 0 0 14px;
      border-left: 4px solid var(--border-hover);
      padding: 4px 0 4px 12px;
      color: var(--muted);
    }
    .document-inner pre {
      overflow-x: auto;
      border-radius: 6px;
      padding: 12px;
      color: #f8fafc;
      background: #1f2937;
    }
    .document-inner code {
      border-radius: 4px;
      padding: 2px 4px;
      background: var(--accent-soft);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    .document-inner pre code {
      padding: 0;
      color: inherit;
      background: transparent;
    }
    .document-inner hr {
      margin: 20px 0;
      border: 0;
      border-top: 1px solid var(--border);
    }
    .document-inner a {
      color: var(--accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .document-inner [data-align="center"] {
      text-align: center;
    }
    .document-inner [data-align="right"] {
      text-align: right;
    }
    .document-inner [data-align="justify"] {
      text-align: justify;
    }
    .watermark {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 0;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      color: rgba(28, 27, 26, 0.08);
      font-size: clamp(44px, 12vw, 132px);
      font-weight: 800;
      letter-spacing: 0;
      line-height: 1;
      text-align: center;
      transform: rotate(-28deg);
      user-select: none;
      white-space: nowrap;
    }
    .watermark.visible {
      display: flex;
    }
    body.unlocked main {
      width: 100%;
      padding-top: 0;
    }
    body.unlocked .unlock {
      display: none;
    }
    body.unlocked .document {
      display: block;
    }
    @media print {
      header, .unlock { display: none; }
      body, .document { background: #fff; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1>${title}</h1>
      <div class="meta">
        ${issuer ? `<span>발행자: ${issuer}</span>` : ""}
        ${issuedAt ? `<span>발행일: ${issuedAt}</span>` : ""}
        ${expiresAt ? `<span>표시용 만료일: ${expiresAt}</span>` : ""}
      </div>
    </header>
    <main>
      <form id="unlock-form" class="unlock" autocomplete="off">
        <h2>보안문서 열람</h2>
        <p>이 문서는 암호화되어 있습니다. 별도 안내받은 ${pinHelpText}을 입력하세요.</p>
        <label>
          문서 열람 PIN
          <input id="pin-input" name="pin" type="password" autocomplete="one-time-code" required>
        </label>
        <button id="unlock-button" type="submit">열람하기</button>
        <p id="status" class="status" aria-live="polite"></p>
        <p id="error" class="error" aria-live="assertive"></p>
      </form>
      <section id="document" class="document" aria-live="polite">
        <div id="watermark" class="watermark" aria-hidden="true"></div>
        <div id="document-inner" class="document-inner"></div>
      </section>
    </main>
  </div>
  <script id="secure-doc-package" type="application/json">${packageJson}</script>
  <script>
(() => {
  "use strict";
  const PACKAGE_SCHEMA = "${PACKAGE_SCHEMA}";
  const PACKAGE_VERSION = "${PACKAGE_VERSION}";
  const PUBLIC_ERROR = "${PUBLIC_UNLOCK_ERROR}";
  const form = document.getElementById("unlock-form");
  const pinInput = document.getElementById("pin-input");
  const button = document.getElementById("unlock-button");
  const status = document.getElementById("status");
  const error = document.getElementById("error");
  const documentInner = document.getElementById("document-inner");
  const watermark = document.getElementById("watermark");
  const packageNode = document.getElementById("secure-doc-package");
  const pkg = JSON.parse(packageNode.textContent || "{}");
  const PIN_MIN_LENGTH = ${PIN_MIN_LENGTH};
  const PIN_MAX_LENGTH = ${PIN_MAX_LENGTH};
  const CONTROL_CHARACTERS = /[\\u0000-\\u001F\\u007F]/;
  const THEME_VARIABLES = {
    accentColor: "--accent",
    accentSoftColor: "--accent-soft",
    backgroundColor: "--bg",
    surfaceColor: "--surface",
    textColor: "--fg",
    mutedTextColor: "--muted",
    borderColor: "--border",
    documentBorderColor: "--document-border"
  };

  function normalizePin(value) {
    return String(value || "").normalize("NFKC").trim();
  }

  function isSafeThemeColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || ""));
  }

  function applyViewerTheme(theme) {
    if (!theme || typeof theme !== "object") {
      return;
    }
    for (const [key, variableName] of Object.entries(THEME_VARIABLES)) {
      const value = theme[key];
      if (isSafeThemeColor(value)) {
        document.documentElement.style.setProperty(variableName, String(value).toLowerCase());
      }
    }
  }

  function base64UrlToBytes(value) {
    if (!/^[A-Za-z0-9_-]*$/.test(value)) {
      throw new Error("Invalid package data.");
    }
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(base64);
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      output[index] = binary.charCodeAt(index);
    }
    return output;
  }

  function bytesEqual(left, right) {
    if (left.length !== right.length) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index += 1) {
      diff |= left[index] ^ right[index];
    }
    return diff === 0;
  }

  function buildAadJson(doc) {
    return JSON.stringify({
      schema: PACKAGE_SCHEMA,
      version: PACKAGE_VERSION,
      docId: doc.id,
      title: doc.title,
      issuer: doc.issuer,
      issuedAt: doc.issuedAt,
      displayExpiresAt: doc.displayExpiresAt || null,
      contentType: "application/json; format=secure-doc-content"
    });
  }

  async function deriveKek(pin, salt, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations
      },
      keyMaterial,
      {
        name: "AES-GCM",
        length: 256
      },
      false,
      ["decrypt"]
    );
  }

  async function unlock(pinInputValue) {
    const pin = normalizePin(pinInputValue);
    const pinLength = Array.from(pin).length;
    if (pinLength < PIN_MIN_LENGTH || pinLength > PIN_MAX_LENGTH || CONTROL_CHARACTERS.test(pin)) {
      throw new Error(PUBLIC_ERROR);
    }

    const aadBytes = new TextEncoder().encode(buildAadJson(pkg.doc));
    const storedAad = base64UrlToBytes(pkg.crypto.contentEncryption.aad);
    if (!bytesEqual(aadBytes, storedAad)) {
      throw new Error(PUBLIC_ERROR);
    }

    const kek = await deriveKek(pin, base64UrlToBytes(pkg.crypto.kdf.salt), pkg.crypto.kdf.iterations);
    const rawDek = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(pkg.crypto.keyWrap.iv),
        tagLength: 128
      },
      kek,
      base64UrlToBytes(pkg.crypto.keyWrap.ciphertext)
    );
    const dek = await crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM" }, false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64UrlToBytes(pkg.crypto.contentEncryption.iv),
        additionalData: aadBytes,
        tagLength: 128
      },
      dek,
      base64UrlToBytes(pkg.crypto.contentEncryption.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function sanitizeHtml(input) {
    const template = document.createElement("template");
    template.innerHTML = String(input || "");
    const allowedTags = new Set(["ARTICLE", "SECTION", "HEADER", "FOOTER", "H1", "H2", "H3", "H4", "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "DEL", "STRIKE", "CODE", "PRE", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "IMG", "BLOCKQUOTE", "HR", "SPAN"]);
    const removedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON"]);
    const allowedAttrs = {
      A: new Set(["href", "title"]),
      H1: new Set(["data-align"]),
      H2: new Set(["data-align"]),
      H3: new Set(["data-align"]),
      H4: new Set(["data-align"]),
      IMG: new Set(["src", "alt", "title"]),
      P: new Set(["data-align"]),
      TH: new Set(["colspan", "rowspan"]),
      TD: new Set(["colspan", "rowspan"])
    };
    const allowedAlignments = new Set(["center", "right", "justify"]);

    function isSafeUrl(value, imageOnly) {
      const trimmed = String(value || "").trim();
      if (imageOnly) return /^data:image\\/(png|jpeg|jpg|gif|webp);base64,/i.test(trimmed) || /^blob:/i.test(trimmed);
      return /^(https:|mailto:|tel:)/i.test(trimmed);
    }

    function removeUnsupportedEditorCharacters(value) {
      return String(value || "").normalize("NFKC").replace(/[\\p{Script=Han}\\uF900-\\uFAFF]/gu, "");
    }

    function clean(node) {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          child.textContent = removeUnsupportedEditorCharacters(child.textContent);
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) {
          child.remove();
          continue;
        }
        const element = child;
        if (removedTags.has(element.tagName)) {
          element.remove();
          continue;
        }
        if (!allowedTags.has(element.tagName)) {
          clean(element);
          element.replaceWith(...Array.from(element.childNodes));
          continue;
        }
        for (const attr of Array.from(element.attributes)) {
          const attrName = attr.name.toLowerCase();
          const tagAttrs = allowedAttrs[element.tagName];
          if (attrName.startsWith("on") || !(tagAttrs && tagAttrs.has(attrName))) {
            element.removeAttribute(attr.name);
            continue;
          }
          if (attrName === "href" && !isSafeUrl(attr.value, false)) element.removeAttribute(attr.name);
          if (attrName === "src" && !isSafeUrl(attr.value, true)) element.removeAttribute(attr.name);
          if (attrName === "data-align" && !allowedAlignments.has(attr.value)) element.removeAttribute(attr.name);
        }
        clean(element);
      }
    }

    clean(template.content);
    return template.innerHTML;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    error.textContent = "";
    status.textContent = "문서를 복호화하는 중입니다.";
    try {
      const content = await unlock(pinInput.value);
      documentInner.innerHTML = sanitizeHtml(content.html);
      const watermarkText = String(content.privateMeta && content.privateMeta.watermarkText || "").trim();
      const branding = content.privateMeta && content.privateMeta.branding;
      applyViewerTheme(branding && branding.viewerTheme);
      watermark.textContent = watermarkText;
      watermark.classList.toggle("visible", Boolean(watermarkText));
      pinInput.value = "";
      status.textContent = "";
      document.body.classList.add("unlocked");
    } catch {
      error.textContent = PUBLIC_ERROR;
      status.textContent = "";
    } finally {
      button.disabled = false;
    }
  });
})();
  </script>
</body>
</html>`;
}
