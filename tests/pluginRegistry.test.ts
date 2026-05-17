import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_PLUGIN_MANIFESTS,
  PLUGIN_CATEGORIES,
  PLUGIN_CONTRIBUTION_PERMISSION_REQUIREMENTS,
  PLUGIN_ID_PREFIXES_BY_CATEGORY,
  PLUGIN_PERMISSIONS,
  buildPluginDescriptors,
  getEnabledPluginContributions,
  getPluginManifestContractViolations,
  type PluginManifest
} from "../src/shared/plugins.ts";

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
    policyProfiles: []
  });
  assert.deepEqual(PLUGIN_ID_PREFIXES_BY_CATEGORY, {
    delivery: ["delivery."],
    template: ["template-pack."],
    audit: ["audit."],
    branding: ["branding."],
    policy: ["policy."]
  });
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

  const auditPlugin = BUILT_IN_PLUGIN_MANIFESTS.find((plugin) => plugin.id === "audit.integrity.report");
  assert.ok(auditPlugin);
  assert.equal(auditPlugin.category, "audit");
  assert.deepEqual(auditPlugin.permissions, ["history:read", "package:read"]);
  assert.equal(auditPlugin.contributes.historyActions?.[0]?.id, "verify-package");

  const policyPlugin = BUILT_IN_PLUGIN_MANIFESTS.find((plugin) => plugin.id === "policy.strict-pin");
  assert.ok(policyPlugin);
  assert.equal(policyPlugin.category, "policy");
  assert.deepEqual(policyPlugin.permissions, []);
  assert.equal(policyPlugin.contributes.policyProfiles?.[0]?.id, "strict-pin");
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

  const auditContributions = getEnabledPluginContributions(["audit.integrity.report"]);
  assert.equal(auditContributions.publishActions.length, 0);
  assert.equal(auditContributions.historyActions.length, 1);
  assert.equal(auditContributions.historyActions[0].pluginId, "audit.integrity.report");
  assert.equal(auditContributions.historyActions[0].id, "verify-package");

  const policyContributions = getEnabledPluginContributions(["policy.strict-pin"]);
  assert.equal(policyContributions.policyProfiles.length, 1);
  assert.equal(policyContributions.policyProfiles[0].pluginId, "policy.strict-pin");
  assert.equal(policyContributions.policyProfiles[0].id, "strict-pin");
});
