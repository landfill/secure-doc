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

const pin = "048291";
const content: SecureDocPlainContent = {
  type: "secure-doc-content",
  version: "1.0",
  format: "html",
  html: "<article><h1>Secret</h1><p>classified-plain-body</p></article>",
  assets: []
};

test("issues and unlocks a DEK/KEK separated package with a six-digit PIN", async () => {
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
  assert.equal(pkg.ui.keyPolicy.type, "numeric-pin");
  assert.equal(pkg.ui.keyPolicy.length, 6);
  assert.equal(pkg.ui.keyPolicy.allowLeadingZero, true);
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

  await assert.rejects(() => unlockSecureDocument("048292", pkg), {
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
  assert.doesNotMatch(html, /type="number"/);
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
