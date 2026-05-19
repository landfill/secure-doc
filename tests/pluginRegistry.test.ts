import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_PLUGIN_MANIFESTS,
  BUSINESS_TEMPLATE_PACK_PLUGIN_ID,
  PLUGIN_CATEGORIES,
  PLUGIN_CONTRIBUTION_PERMISSION_REQUIREMENTS,
  PLUGIN_ID_PREFIXES_BY_CATEGORY,
  PLUGIN_PERMISSIONS,
  COMPANY_DEFAULT_BRANDING_PLUGIN_ID,
  GENERIC_SMTP_PLUGIN_ID,
  RETIRED_PLUGIN_IDS,
  buildPluginDescriptors,
  getEnabledPluginContributions,
  getPluginManifestContractViolations,
  type PluginManifest
} from "../src/shared/plugins.ts";
import type { SecureDocViewerTheme } from "../src/shared/branding.ts";

test("plugin category, permission, and contribution contracts are explicit", () => {
  assert.deepEqual(PLUGIN_CATEGORIES, ["delivery", "template", "audit", "branding", "policy"]);
  assert.deepEqual(PLUGIN_PERMISSIONS, [
    "network:smtp",
    "secret:safeStorage",
    "package:read",
    "history:read",
    "history:write",
    "ui:settings",
    "ui:publish-action"
  ]);
  assert.deepEqual(PLUGIN_CONTRIBUTION_PERMISSION_REQUIREMENTS, {
    settingsPanel: ["ui:settings"],
    publishActions: ["ui:publish-action"],
    templates: [],
    historyActions: ["history:read"],
    policyProfiles: [],
    brandingPresets: []
  });
  assert.deepEqual(PLUGIN_ID_PREFIXES_BY_CATEGORY, {
    delivery: ["delivery."],
    template: ["template-pack."],
    audit: ["audit."],
    branding: ["branding."],
    policy: ["policy."]
  });
  assert.deepEqual(RETIRED_PLUGIN_IDS, ["audit.integrity.report", "policy.strict-pin"]);
});

test("built-in plugin manifests expose stable ids, permissions, and extension points", () => {
  const ids = BUILT_IN_PLUGIN_MANIFESTS.map((plugin) => plugin.id);
  assert.equal(new Set(ids).size, ids.length);

  assert.deepEqual(BUILT_IN_PLUGIN_MANIFESTS.flatMap(getPluginManifestContractViolations), []);

  const smtpPlugin = BUILT_IN_PLUGIN_MANIFESTS.find((plugin) => plugin.id === "delivery.smtp.gmail");
  assert.ok(smtpPlugin);
  assert.equal(smtpPlugin.category, "delivery");
  assert.deepEqual(smtpPlugin.permissions, [
    "network:smtp",
    "secret:safeStorage",
    "package:read",
    "history:read",
    "ui:settings",
    "ui:publish-action"
  ]);
  assert.equal(smtpPlugin.contributes.settingsPanel, true);
  assert.equal(smtpPlugin.contributes.publishActions?.[0]?.id, "send-email");
  assert.equal(smtpPlugin.contributes.historyActions?.[0]?.id, "send-email-from-history");

  const genericSmtpPlugin = BUILT_IN_PLUGIN_MANIFESTS.find((plugin) => plugin.id === GENERIC_SMTP_PLUGIN_ID);
  assert.ok(genericSmtpPlugin);
  assert.equal(genericSmtpPlugin.category, "delivery");
  assert.deepEqual(genericSmtpPlugin.permissions, [
    "network:smtp",
    "secret:safeStorage",
    "package:read",
    "history:read",
    "ui:settings",
    "ui:publish-action"
  ]);
  assert.equal(genericSmtpPlugin.contributes.settingsPanel, true);
  assert.equal(genericSmtpPlugin.contributes.publishActions?.[0]?.id, "send-email");
  assert.equal(genericSmtpPlugin.contributes.historyActions?.[0]?.id, "send-email-from-history");

  assert.equal(
    BUILT_IN_PLUGIN_MANIFESTS.some((plugin) => (RETIRED_PLUGIN_IDS as readonly string[]).includes(plugin.id)),
    false
  );

  const brandingPlugin = BUILT_IN_PLUGIN_MANIFESTS.find((plugin) => plugin.id === COMPANY_DEFAULT_BRANDING_PLUGIN_ID);
  assert.ok(brandingPlugin);
  assert.equal(brandingPlugin.category, "branding");
  assert.deepEqual(brandingPlugin.permissions, []);
  assert.equal(brandingPlugin.contributes.brandingPresets?.[0]?.id, "company-defaults");
  assert.equal(brandingPlugin.contributes.brandingPresets?.[0]?.issuer, "Secure Doc Team");
  assert.equal(brandingPlugin.contributes.brandingPresets?.[0]?.viewerTheme?.accentColor, "#2f6fed");

  const templatePlugin = BUILT_IN_PLUGIN_MANIFESTS.find((plugin) => plugin.id === BUSINESS_TEMPLATE_PACK_PLUGIN_ID);
  assert.ok(templatePlugin);
  assert.equal(templatePlugin.category, "template");
  assert.deepEqual(templatePlugin.permissions, []);
  assert.deepEqual(
    templatePlugin.contributes.templates?.map((template) => template.id),
    ["core.insurance-certificate", "core.billing-notice"]
  );
});

test("plugin manifest contract catches permission and naming drift", () => {
  const invalidManifest: PluginManifest = {
    id: "smtp.gmail",
    name: "Invalid SMTP",
    version: "0.1.0",
    description: "Intentionally invalid test manifest.",
    category: "delivery",
    permissions: ["package:read"],
    contributes: {
      settingsPanel: true,
      publishActions: [
        {
          id: "send-email",
          label: "Send email",
          description: "Send the issued package."
        },
        {
          id: "send-email",
          label: "Send duplicate email",
          description: "Duplicate action for regression coverage."
        }
      ],
      historyActions: [
        {
          id: "Send From History",
          label: "Send from history",
          description: "Invalid action id for regression coverage."
        }
      ]
    }
  };

  assert.deepEqual(getPluginManifestContractViolations(invalidManifest), [
    "smtp.gmail: plugin id must match the delivery category prefix",
    "smtp.gmail: settingsPanel requires ui:settings",
    "smtp.gmail: publishActions requires ui:publish-action",
    "smtp.gmail: historyActions requires history:read",
    "smtp.gmail: duplicate publishActions id send-email",
    "smtp.gmail: historyActions id Send From History must use lowercase dot/dash segments"
  ]);
});

test("plugin manifest contract blocks retired ids and core security replacements", () => {
  const retiredAuditManifest: PluginManifest = {
    id: "audit.integrity.report",
    name: "Retired Audit",
    version: "0.1.0",
    description: "Attempts to restore a retired core capability as a plugin.",
    category: "audit",
    permissions: ["history:read"],
    contributes: {
      historyActions: [
        {
          id: "verify-package",
          label: "Verify package",
          description: "Verify saved package integrity."
        }
      ]
    }
  };

  assert.deepEqual(getPluginManifestContractViolations(retiredAuditManifest), [
    "audit.integrity.report: plugin id is retired because this capability is now core"
  ]);

  const coreReplacementManifest = {
    id: "policy.viewer-replacement",
    name: "Viewer Replacement",
    version: "0.1.0",
    description: "Attempts to replace core viewer behavior.",
    category: "policy",
    permissions: [],
    coreReplacements: ["viewer-html", "pin"],
    contributes: {
      viewerHtml: true
    }
  } as unknown as PluginManifest;

  assert.deepEqual(getPluginManifestContractViolations(coreReplacementManifest), [
    "policy.viewer-replacement: core security surfaces are not replaceable by plugins",
    "policy.viewer-replacement: contribution point viewerHtml is not supported"
  ]);
});

test("template pack manifests can contribute static templates without network or secret permissions", () => {
  const templatePackManifest: PluginManifest = {
    id: "template-pack.legal",
    name: "Legal Template Pack",
    version: "0.1.0",
    description: "Static legal document templates.",
    category: "template",
    permissions: [],
    contributes: {
      templates: [
        {
          id: "contract-basic",
          label: "Basic contract",
          description: "Safe static contract structure."
        }
      ]
    }
  };

  assert.deepEqual(getPluginManifestContractViolations(templatePackManifest), []);
});

test("policy manifests can contribute stricter publish profiles without permissions", () => {
  const policyManifest: PluginManifest = {
    id: "policy.required-metadata",
    name: "Required Metadata Policy",
    version: "0.1.0",
    description: "Requires extra metadata before publish.",
    category: "policy",
    permissions: [],
    contributes: {
      policyProfiles: [
        {
          id: "required-metadata",
          label: "Required metadata",
          description: "Requires recipient and document number.",
          minimumPinLength: 12,
          minimumKdfIterations: 1_200_000,
          requiredMetadata: ["recipientName", "documentNumber"],
          requireWatermark: true
        }
      ]
    }
  };

  assert.deepEqual(getPluginManifestContractViolations(policyManifest), []);
});

test("branding manifests can contribute safe offline viewer presets without permissions", () => {
  const brandingManifest: PluginManifest = {
    id: "branding.client-pack",
    name: "Client Brand Pack",
    version: "0.1.0",
    description: "Static client branding presets.",
    category: "branding",
    permissions: [],
    contributes: {
      brandingPresets: [
        {
          id: "client-default",
          label: "Client default",
          description: "Applies client issuer, watermark, and viewer colors.",
          issuer: "Client Corp",
          watermarkText: "CLIENT",
          viewerTheme: {
            accentColor: "#123456",
            accentSoftColor: "#eef4ff",
            backgroundColor: "#ffffff",
            surfaceColor: "#ffffff",
            textColor: "#111827",
            mutedTextColor: "#4b5563",
            borderColor: "#d1d5db",
            documentBorderColor: "#123456"
          }
        }
      ]
    }
  };

  assert.deepEqual(getPluginManifestContractViolations(brandingManifest), []);
});

test("branding manifest contract blocks unsafe viewer theme colors", () => {
  const unsafeBrandingManifest: PluginManifest = {
    id: "branding.unsafe",
    name: "Unsafe Brand Pack",
    version: "0.1.0",
    description: "Invalid branding preset for regression coverage.",
    category: "branding",
    permissions: [],
    contributes: {
      brandingPresets: [
        {
          id: "unsafe",
          label: "Unsafe",
          description: "Invalid colors.",
          viewerTheme: {
            accentColor: "url(https://example.com/a.png)",
            unsupportedColor: "#ffffff"
          } as SecureDocViewerTheme
        }
      ]
    }
  };

  assert.deepEqual(getPluginManifestContractViolations(unsafeBrandingManifest), [
    "branding.unsafe: branding preset unsafe: viewer theme accentColor must be a #rrggbb color",
    "branding.unsafe: branding preset unsafe: viewer theme unsupportedColor is not supported"
  ]);
});

test("policy manifest contract blocks weaker or unsupported profile requirements", () => {
  const weakPolicyManifest: PluginManifest = {
    id: "policy.weak",
    name: "Weak Policy",
    version: "0.1.0",
    description: "Intentionally weak policy profile for regression coverage.",
    category: "policy",
    permissions: [],
    contributes: {
      policyProfiles: [
        {
          id: "weak-policy",
          label: "Weak policy",
          description: "Invalid weak requirements.",
          minimumPinLength: 4,
          minimumKdfIterations: 100_000,
          requiredMetadata: ["issuer" as "recipientName"]
        }
      ]
    }
  };

  assert.deepEqual(getPluginManifestContractViolations(weakPolicyManifest), [
    "policy.weak: policy profile weak-policy minimumPinLength must be between 6 and 15",
    "policy.weak: policy profile weak-policy minimumKdfIterations must be at least 1000000",
    "policy.weak: policy profile weak-policy requiredMetadata field issuer is not supported"
  ]);
});

test("plugin descriptors and contributions are driven only by enabled state", () => {
  const disabledDescriptors = buildPluginDescriptors([]);
  assert.equal(disabledDescriptors.every((plugin) => !plugin.enabled), true);
  assert.equal(getEnabledPluginContributions([]).publishActions.length, 0);

  const enabledDescriptors = buildPluginDescriptors(["delivery.smtp.gmail"]);
  assert.equal(enabledDescriptors.find((plugin) => plugin.id === "delivery.smtp.gmail")?.enabled, true);

  const contributions = getEnabledPluginContributions(["delivery.smtp.gmail"]);
  assert.equal(contributions.publishActions.length, 1);
  assert.equal(contributions.publishActions[0].pluginId, "delivery.smtp.gmail");
  assert.equal(contributions.templates.length, 0);
  assert.equal(contributions.historyActions.length, 1);
  assert.equal(contributions.historyActions[0].pluginId, "delivery.smtp.gmail");
  assert.equal(contributions.policyProfiles.length, 0);
  assert.equal(contributions.brandingPresets.length, 0);

  const genericContributions = getEnabledPluginContributions([GENERIC_SMTP_PLUGIN_ID]);
  assert.equal(genericContributions.publishActions.length, 1);
  assert.equal(genericContributions.publishActions[0].pluginId, GENERIC_SMTP_PLUGIN_ID);
  assert.equal(genericContributions.historyActions.length, 1);
  assert.equal(genericContributions.historyActions[0].pluginId, GENERIC_SMTP_PLUGIN_ID);

  const brandingContributions = getEnabledPluginContributions([COMPANY_DEFAULT_BRANDING_PLUGIN_ID]);
  assert.equal(brandingContributions.publishActions.length, 0);
  assert.equal(brandingContributions.brandingPresets.length, 1);
  assert.equal(brandingContributions.brandingPresets[0].pluginId, COMPANY_DEFAULT_BRANDING_PLUGIN_ID);
  assert.equal(brandingContributions.brandingPresets[0].viewerTheme?.documentBorderColor, "#2f6fed");

  const templateContributions = getEnabledPluginContributions([BUSINESS_TEMPLATE_PACK_PLUGIN_ID]);
  assert.equal(templateContributions.publishActions.length, 0);
  assert.equal(templateContributions.templates.length, 2);
  assert.equal(templateContributions.templates[0].pluginId, BUSINESS_TEMPLATE_PACK_PLUGIN_ID);
  assert.equal(templateContributions.brandingPresets.length, 0);
});
