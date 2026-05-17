import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPluginStore } from "../src/main/pluginStore.ts";

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
