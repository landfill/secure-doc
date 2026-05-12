import { PACKAGE_SCHEMA, PACKAGE_VERSION, PUBLIC_UNLOCK_ERROR, type SecureDocPackage } from "./securePackage.ts";

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
      background: #f5f7fb;
      color: #18202f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: #f5f7fb;
    }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    header {
      padding: 28px min(7vw, 72px) 18px;
      border-bottom: 1px solid #d9e0eb;
      background: #ffffff;
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
      color: #5d6878;
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
      color: #5d6878;
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
      border: 1px solid #aeb9c9;
      border-radius: 6px;
      padding: 0 14px;
      font: inherit;
      letter-spacing: 0;
      background: #fff;
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
      color: #fff;
      background: #155eef;
      cursor: pointer;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.66;
    }
    .error {
      min-height: 22px;
      color: #b42318;
      font-weight: 700;
    }
    .document {
      display: none;
      padding: 32px 0;
      line-height: 1.7;
      background: #fff;
      border-top: 4px solid #155eef;
    }
    .document-inner {
      width: min(820px, calc(100% - 40px));
      margin: 0 auto;
    }
    .document-inner table {
      width: 100%;
      border-collapse: collapse;
    }
    .document-inner th, .document-inner td {
      border: 1px solid #d9e0eb;
      padding: 8px 10px;
      text-align: left;
    }
    .document-inner img {
      max-width: 100%;
      height: auto;
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
        <p>이 문서는 암호화되어 있습니다. 별도 안내받은 6자리 숫자 PIN을 입력하세요.</p>
        <label>
          문서 열람 PIN
          <input id="pin-input" name="pin" type="password" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" autocomplete="one-time-code" required>
        </label>
        <button id="unlock-button" type="submit">열람하기</button>
        <p id="status" class="status" aria-live="polite"></p>
        <p id="error" class="error" aria-live="assertive"></p>
      </form>
      <section id="document" class="document" aria-live="polite">
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
  const packageNode = document.getElementById("secure-doc-package");
  const pkg = JSON.parse(packageNode.textContent || "{}");

  function normalizePin(value) {
    return String(value || "").normalize("NFKC").trim();
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
    if (!/^[0-9]{6}$/.test(pin)) {
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
    const allowedTags = new Set(["ARTICLE", "SECTION", "HEADER", "FOOTER", "H1", "H2", "H3", "H4", "P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "A", "IMG", "BLOCKQUOTE", "HR", "SPAN"]);
    const removedTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON"]);
    const allowedAttrs = {
      A: new Set(["href", "title"]),
      IMG: new Set(["src", "alt", "title"]),
      TH: new Set(["colspan", "rowspan"]),
      TD: new Set(["colspan", "rowspan"])
    };

    function isSafeUrl(value, imageOnly) {
      const trimmed = String(value || "").trim();
      if (imageOnly) return /^data:image\\/(png|jpeg|jpg|gif|webp);base64,/i.test(trimmed) || /^blob:/i.test(trimmed);
      return /^(https:|mailto:|tel:)/i.test(trimmed);
    }

    function clean(node) {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) continue;
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
