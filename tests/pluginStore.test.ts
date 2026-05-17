import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPluginStore } from "../src/main/pluginStore.ts";
import type { PluginManifest } from "../src/shared/plugins.ts";

async function withTempUserData(run: (userDataPath: string) => Promise<void>): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), "secure-doc-plugin-store-"));
  try {
    await run(userDataPath);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
}

test("plugin store persists enabled built-in plugins and resolves contributions", async () => {
  await withTempUserData(async (userDataPath) => {
    const store = createPluginStore(userDataPath);

    assert.equal((await store.list()).find((plugin) => plugin.id === "delivery.smtp.gmail")?.enabled, false);

    await store.setEnabled("delivery.smtp.gmail", true);
    assert.equal((await store.list()).find((plugin) => plugin.id === "delivery.smtp.gmail")?.enabled, true);
    assert.equal((await store.getContributions()).publishActions[0].id, "send-email");

    const reloadedStore = createPluginStore(userDataPath);
    assert.equal((await reloadedStore.list()).find((plugin) => plugin.id === "delivery.smtp.gmail")?.enabled, true);

    const persisted = JSON.parse(await readFile(join(userDataPath, "plugin-state.json"), "utf8"));
    assert.deepEqual(persisted.enabledPluginIds, ["delivery.smtp.gmail"]);

    await reloadedStore.setEnabled("delivery.smtp.gmail", false);
    assert.equal((await reloadedStore.getContributions()).publishActions.length, 0);
  });
});

test("plugin store rejects unknown plugin ids", async () => {
  await withTempUserData(async (userDataPath) => {
    const store = createPluginStore(userDataPath);
    await assert.rejects(() => store.setEnabled("delivery.unknown", true), /Unknown plugin/);
  });
});

test("plugin store treats corrupt state files as empty state", async () => {
  await withTempUserData(async (userDataPath) => {
    await writeFile(join(userDataPath, "plugin-state.json"), "{", "utf8");

    const store = createPluginStore(userDataPath);
    assert.equal((await store.list()).find((plugin) => plugin.id === "delivery.smtp.gmail")?.enabled, false);

    await store.setEnabled("delivery.smtp.gmail", true);
    const persisted = JSON.parse(await readFile(join(userDataPath, "plugin-state.json"), "utf8"));
    assert.deepEqual(persisted.enabledPluginIds, ["delivery.smtp.gmail"]);
  });
});

test("plugin store serializes concurrent enablement updates", async () => {
  const manifests: PluginManifest[] = [
    {
      id: "delivery.smtp.gmail",
      name: "Gmail SMTP Delivery",
      version: "0.1.0",
      description: "SMTP test plugin.",
      category: "delivery",
      permissions: [],
      contributes: {}
    },
    {
      id: "template-pack.test",
      name: "Template Pack Test",
      version: "0.1.0",
      description: "Template test plugin.",
      category: "template",
      permissions: [],
      contributes: {}
    }
  ];

  await withTempUserData(async (userDataPath) => {
    const store = createPluginStore(userDataPath, manifests);
    await Promise.all([store.setEnabled("delivery.smtp.gmail", true), store.setEnabled("template-pack.test", true)]);

    const persisted = JSON.parse(await readFile(join(userDataPath, "plugin-state.json"), "utf8"));
    assert.deepEqual(persisted.enabledPluginIds, ["delivery.smtp.gmail", "template-pack.test"]);
  });
});
