import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_DOCUMENT_TEMPLATES,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  DOCUMENT_TEMPLATE_CATEGORIES,
  applyDocumentTemplateDefaults,
  buildDocumentTemplateBodyHtml,
  getDocumentTemplateById,
  type DocumentTemplateMetadata
} from "../src/shared/documentTemplates.ts";

const baseMetadata: DocumentTemplateMetadata = {
  title: "",
  issuer: "발행팀",
  description: "",
  docType: "기타",
  displayExpiresAt: "2026-12-31",
  watermarkText: "",
  recipientName: "수신자",
  documentNumber: "DOC-2026-0001",
  createdBy: "admin"
};

test("core document template registry exposes stable safe defaults", () => {
  assert.deepEqual(DOCUMENT_TEMPLATE_CATEGORIES, ["notice", "contract", "policy", "general"]);

  const ids = CORE_DOCUMENT_TEMPLATES.map((template) => template.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(DEFAULT_DOCUMENT_TEMPLATE_ID, "core.notice");

  for (const requiredId of ["core.notice", "core.contract", "core.policy", "core.general"]) {
    const template = getDocumentTemplateById(requiredId);
    assert.ok(template, `${requiredId} should exist`);
    assert.equal(template?.pluginId, undefined);
    assert.ok(template?.defaultMetadata.title);
    assert.ok(template?.defaultMetadata.docType);
    assert.ok(template?.defaultMetadata.watermarkText);
  }
});

test("template defaults update metadata without dropping operator fields", () => {
  const template = getDocumentTemplateById("core.policy");
  assert.ok(template);

  const nextMetadata = applyDocumentTemplateDefaults(baseMetadata, template);
  assert.equal(nextMetadata.title, "보안 운영 정책");
  assert.equal(nextMetadata.description, "정책 또는 규정 문서 초안");
  assert.equal(nextMetadata.docType, "정책/규정");
  assert.equal(nextMetadata.createdBy, "admin");
  assert.equal(nextMetadata.issuer, "발행팀");
});

test("template body builders escape metadata and avoid unsafe external content", () => {
  const template = getDocumentTemplateById("core.contract");
  assert.ok(template);

  const html = buildDocumentTemplateBodyHtml(template, {
    ...baseMetadata,
    title: "계약서<script>alert(1)</script>",
    issuer: "갑忍",
    recipientName: "<b>을</b>"
  });

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;을&lt;\/b&gt;/);
  assert.equal(html.includes("忍"), false);
  assert.doesNotMatch(html, /<script|<iframe|<img|https?:\/\//i);
});

test("core templates do not carry stored secrets or real sensitive examples", () => {
  const renderedTemplates = CORE_DOCUMENT_TEMPLATES.map((template) =>
    buildDocumentTemplateBodyHtml(template, applyDocumentTemplateDefaults(baseMetadata, template))
  ).join("\n");
  const serializedDefaults = JSON.stringify(CORE_DOCUMENT_TEMPLATES.map((template) => template.defaultMetadata));
  const serialized = `${serializedDefaults}\n${renderedTemplates}`;

  assert.doesNotMatch(serialized, /pin hash|pinhash|DEK|KEK|private key|BEGIN [A-Z ]+ KEY/i);
});
