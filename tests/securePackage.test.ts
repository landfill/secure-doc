import test from "node:test";
import assert from "node:assert/strict";
import {
  issueSecureDocument,
  PUBLIC_UNLOCK_ERROR,
  unlockSecureDocument,
  type SecureDocPackage,
  type SecureDocPlainContent
} from "../src/shared/securePackage.ts";
import { buildSecureHtmlDocument } from "../src/shared/viewerHtml.ts";

const pin = "A9-zK2!mP4_q";
const content: SecureDocPlainContent = {
  type: "secure-doc-content",
  version: "1.0",
  format: "html",
  html: "<article><h1>Secret</h1><p>classified-plain-body</p></article>",
  assets: []
};

test("issues and unlocks a DEK/KEK separated package with a PIN in policy range", async () => {
  const pkg = await issueSecureDocument({
    content,
    pin,
    iterations: 1000,
    metadata: {
      id: "doc_20260512_test",
      title: "보안문서",
      issuer: "회사명",
      issuedAt: "2026-05-12T09:00:00+09:00"
    }
  });

  const unlocked = await unlockSecureDocument(pin, pkg);
  assert.equal(unlocked.html, content.html);
  assert.equal(pkg.crypto.kdf.iterations, 1000);
  assert.equal(pkg.ui.keyPolicy.type, "pin-code");
  assert.equal(pkg.ui.keyPolicy.minLength, 6);
  assert.equal(pkg.ui.keyPolicy.maxLength, 15);
  assert.equal(pkg.ui.keyPolicy.allowedCharacters, "printable");
});

test("uses one public failure message for wrong PIN and metadata tampering", async () => {
  const pkg = await issueSecureDocument({
    content,
    pin,
    iterations: 1000,
    metadata: {
      id: "doc_20260512_tamper",
      title: "보안문서",
      issuer: "회사명",
      issuedAt: "2026-05-12T09:00:00+09:00"
    }
  });

  await assert.rejects(() => unlockSecureDocument("A9-zK2!mP4_r", pkg), {
    message: PUBLIC_UNLOCK_ERROR
  });

  const tampered = JSON.parse(JSON.stringify(pkg)) as SecureDocPackage;
  tampered.doc.title = "변조된 제목";
  await assert.rejects(() => unlockSecureDocument(pin, tampered), {
    message: PUBLIC_UNLOCK_ERROR
  });
});

test("does not expose plaintext body or PIN in the package HTML", async () => {
  const pkg = await issueSecureDocument({
    content,
    pin,
    iterations: 1000,
    metadata: {
      id: "doc_20260512_source",
      title: "보안문서",
      issuer: "회사명",
      issuedAt: "2026-05-12T09:00:00+09:00"
    }
  });

  const packageJson = JSON.stringify(pkg);
  const html = buildSecureHtmlDocument(pkg);

  assert.equal(packageJson.includes("classified-plain-body"), false);
  assert.equal(html.includes("classified-plain-body"), false);
  assert.equal(html.includes(pin), false);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /minlength=/);
  assert.doesNotMatch(html, /maxlength=/);
  assert.doesNotMatch(html, /pattern=/);
  assert.doesNotMatch(html, /type="number"/);
});

test("supports non-BMP PINs without native UTF-16 length truncation in the viewer", async () => {
  const emojiPin = "😀😁😂🤣😃😄😅😆";
  const pkg = await issueSecureDocument({
    content,
    pin: emojiPin,
    iterations: 1000,
    metadata: {
      id: "doc_20260512_emoji",
      title: "보안문서",
      issuer: "회사명",
      issuedAt: "2026-05-12T09:00:00+09:00"
    }
  });

  const unlocked = await unlockSecureDocument(emojiPin, pkg);
  const html = buildSecureHtmlDocument(pkg);

  assert.equal(unlocked.html, content.html);
  assert.doesNotMatch(html, /minlength=/);
  assert.doesNotMatch(html, /maxlength=/);
});

test("renders watermark layer after unlock without exposing watermark text before unlock", async () => {
  const watermarkedContent: SecureDocPlainContent = {
    ...content,
    privateMeta: {
      watermarkText: "CONFIDENTIAL"
    }
  };
  const pkg = await issueSecureDocument({
    content: watermarkedContent,
    pin,
    iterations: 1000,
    metadata: {
      id: "doc_20260512_watermark",
      title: "보안문서",
      issuer: "회사명",
      issuedAt: "2026-05-12T09:00:00+09:00"
    }
  });

  const html = buildSecureHtmlDocument(pkg);

  assert.equal(pkg.ui.watermark, true);
  assert.equal(html.includes("CONFIDENTIAL"), false);
  assert.match(html, /id="watermark"/);
  assert.match(html, /watermark\.textContent = watermarkText/);
  assert.match(html, /watermark\.classList\.toggle\("visible", Boolean\(watermarkText\)\)/);
});

test("keeps branding viewer theme encrypted and applies only safe colors after unlock", async () => {
  const brandedContent: SecureDocPlainContent = {
    ...content,
    privateMeta: {
      branding: {
        pluginId: "branding.company-defaults",
        presetId: "company-defaults",
        label: "Company defaults",
        viewerTheme: {
          accentColor: "#123456",
          accentSoftColor: "#eef4ff",
          documentBorderColor: "#123456"
        }
      }
    }
  };
  const pkg = await issueSecureDocument({
    content: brandedContent,
    pin,
    iterations: 1000,
    metadata: {
      id: "doc_20260512_branding",
      title: "보안문서",
      issuer: "회사명",
      issuedAt: "2026-05-12T09:00:00+09:00"
    }
  });

  const html = buildSecureHtmlDocument(pkg);
  const unlocked = await unlockSecureDocument(pin, pkg);

  assert.equal(unlocked.privateMeta?.branding?.viewerTheme?.accentColor, "#123456");
  assert.equal(JSON.stringify(pkg).includes("#123456"), false);
  assert.equal(html.includes("#123456"), false);
  assert.match(html, /applyViewerTheme\(branding && branding\.viewerTheme\)/);
  assert.match(html, /document\.documentElement\.style\.setProperty\(variableName/);
  assert.match(html, /\.document-inner h2/);
  assert.match(html, /background: var\(--accent-soft\)/);
  assert.match(html, /connect-src 'none'/);
});

test("creates different salt, IVs, and wrapped DEKs for the same PIN", async () => {
  const first = await issueSecureDocument({
    content,
    pin,
    iterations: 1000,
    metadata: {
      id: "doc_20260512_a",
      title: "보안문서 A",
      issuer: "회사명",
      issuedAt: "2026-05-12T09:00:00+09:00"
    }
  });
  const second = await issueSecureDocument({
    content,
    pin,
    iterations: 1000,
    metadata: {
      id: "doc_20260512_b",
      title: "보안문서 B",
      issuer: "회사명",
      issuedAt: "2026-05-12T09:00:00+09:00"
    }
  });

  assert.notEqual(first.crypto.kdf.salt, second.crypto.kdf.salt);
  assert.notEqual(first.crypto.keyWrap.iv, second.crypto.keyWrap.iv);
  assert.notEqual(first.crypto.contentEncryption.iv, second.crypto.contentEncryption.iv);
  assert.notEqual(first.crypto.keyWrap.ciphertext, second.crypto.keyWrap.ciphertext);
});
