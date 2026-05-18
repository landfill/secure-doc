import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_DOCUMENT_TEMPLATES,
  CORE_DOCUMENT_TEMPLATES,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  DOCUMENT_TEMPLATE_CATEGORIES,
  TRUSTED_DOCUMENT_TEMPLATES,
  applyDocumentTemplateDefaults,
  buildDocumentTemplateBodyHtml,
  getDocumentTemplateById,
  resolveAvailableDocumentTemplates,
  type DocumentTemplate,
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

test("default template picker starts with core templates and adds enabled template-pack entries", () => {
  assert.deepEqual(
    BASE_DOCUMENT_TEMPLATES.map((template) => template.id),
    ["core.notice", "core.contract", "core.policy", "core.general"]
  );
  assert.ok(TRUSTED_DOCUMENT_TEMPLATES.some((template) => template.id === "core.insurance-certificate"));

  const resolved = resolveAvailableDocumentTemplates([
    {
      id: "core.insurance-certificate",
      label: "보험증서",
      description: "Template surfaced by the business sample pack.",
      pluginId: "template-pack.business-samples",
      pluginName: "업무 문서 템플릿"
    }
  ]);

  assert.deepEqual(
    resolved.map((template) => template.id),
    ["core.notice", "core.contract", "core.policy", "core.general", "core.insurance-certificate"]
  );
  assert.equal(resolved[4].pluginId, "template-pack.business-samples");
  assert.equal(resolved[4].pluginName, "업무 문서 템플릿");
  assert.equal(resolved[4].name, "보험증서");
});

test("plugin template contributions resolve only against trusted bundled templates", () => {
  const baseTemplate = getDocumentTemplateById("core.notice");
  assert.ok(baseTemplate);
  const pluginTemplate: DocumentTemplate = {
    id: "template-pack.legal.basic",
    pluginId: "template-pack.legal",
    name: "Bundled legal template",
    description: "Bundled legal body.",
    category: "contract",
    defaultMetadata: {
      title: "Legal template",
      docType: "Contract"
    },
    buildBodyHtml(metadata) {
      return `<h1>${metadata.title}</h1>`;
    }
  };

  const resolved = resolveAvailableDocumentTemplates(
    [
      {
        id: pluginTemplate.id,
        label: "Legal pack template",
        description: "Template surfaced by an enabled plugin.",
        pluginId: "template-pack.legal",
        pluginName: "Legal Template Pack"
      },
      {
        id: "template-pack.missing",
        label: "Missing template",
        description: "This contribution should be ignored because no bundled builder exists.",
        pluginId: "template-pack.legal",
        pluginName: "Legal Template Pack"
      },
      {
        id: baseTemplate.id,
        label: "Duplicate core notice",
        description: "Core templates should not be duplicated by plugin contributions.",
        pluginId: "template-pack.legal",
        pluginName: "Legal Template Pack"
      }
    ],
    [baseTemplate],
    [baseTemplate, pluginTemplate]
  );

  assert.deepEqual(resolved.map((template) => template.id), [baseTemplate.id, pluginTemplate.id]);
  assert.equal(resolved[1].pluginId, "template-pack.legal");
  assert.equal(resolved[1].pluginName, "Legal Template Pack");
  assert.equal(resolved[1].name, "Legal pack template");
  assert.equal(resolved[1].description, "Template surfaced by an enabled plugin.");
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

test("template body builders escape metadata, preserve user text, and avoid unsafe external content", () => {
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
  assert.match(html, /갑忍/);
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

test("core template copy stays Hanja-free without stripping user metadata", () => {
  const renderedWithDefaults = CORE_DOCUMENT_TEMPLATES.map((template) =>
    buildDocumentTemplateBodyHtml(template, applyDocumentTemplateDefaults(baseMetadata, template))
  ).join("\n");
  assert.doesNotMatch(renderedWithDefaults, /[\p{Script=Han}\uF900-\uFAFF]/u);

  const notice = getDocumentTemplateById("core.notice");
  assert.ok(notice);
  const personalizedHtml = buildDocumentTemplateBodyHtml(notice, {
    ...baseMetadata,
    recipientName: "金수신자",
    issuer: "發행팀"
  });
  assert.match(personalizedHtml, /金수신자/);
  assert.match(personalizedHtml, /發행팀/);
});
