import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_PLUGIN_MANIFESTS,
  buildPluginDescriptors,
  getEnabledPluginContributions
} from "../src/shared/plugins.ts";

test("built-in plugin manifests expose stable ids, permissions, and extension points", () => {
  const ids = BUILT_IN_PLUGIN_MANIFESTS.map((plugin) => plugin.id);
  assert.equal(new Set(ids).size, ids.length);

  const smtpPlugin = BUILT_IN_PLUGIN_MANIFESTS.find((plugin) => plugin.id === "delivery.smtp.gmail");
  assert.ok(smtpPlugin);
  assert.equal(smtpPlugin.category, "delivery");
  assert.deepEqual(smtpPlugin.permissions, [
    "network:smtp",
    "secret:safeStorage",
    "package:read",
    "ui:settings",
    "ui:publish-action"
  ]);
  assert.equal(smtpPlugin.contributes.settingsPanel, true);
  assert.equal(smtpPlugin.contributes.publishActions?.[0]?.id, "send-email");
  assert.equal(smtpPlugin.contributes.historyActions?.[0]?.id, "send-email-from-history");
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
});
