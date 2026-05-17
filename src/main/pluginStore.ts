import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BUILT_IN_PLUGIN_MANIFESTS,
  buildPluginDescriptors,
  getEnabledPluginContributions,
  type PluginContributions,
  type PluginDescriptor,
  type PluginManifest
} from "../shared/plugins.ts";

interface PersistedPluginState {
  enabledPluginIds: string[];
}

export interface PluginStore {
  list(): Promise<PluginDescriptor[]>;
  getContributions(): Promise<PluginContributions>;
  setEnabled(pluginId: string, enabled: boolean): Promise<PluginDescriptor[]>;
}

const emptyState: PersistedPluginState = {
  enabledPluginIds: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeState(value: unknown, manifests: readonly PluginManifest[]): PersistedPluginState {
  if (!isRecord(value) || !Array.isArray(value.enabledPluginIds)) {
    return emptyState;
  }

  const knownIds = new Set(manifests.map((manifest) => manifest.id));
  const enabledIds = value.enabledPluginIds.filter(
    (pluginId): pluginId is string => typeof pluginId === "string" && knownIds.has(pluginId)
  );

  return {
    enabledPluginIds: sortEnabledIds([...new Set(enabledIds)], manifests)
  };
}

function sortEnabledIds(enabledPluginIds: readonly string[], manifests: readonly PluginManifest[]): string[] {
  const enabledIds = new Set(enabledPluginIds);
  return manifests.map((manifest) => manifest.id).filter((pluginId) => enabledIds.has(pluginId));
}

export function createPluginStore(
  userDataPath: string,
  manifests: readonly PluginManifest[] = BUILT_IN_PLUGIN_MANIFESTS
): PluginStore {
  const statePath = join(userDataPath, "plugin-state.json");
  const knownIds = new Set(manifests.map((manifest) => manifest.id));
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(mutation, mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function readState(): Promise<PersistedPluginState> {
    try {
      const raw = await readFile(statePath, "utf8");
      return normalizeState(JSON.parse(raw), manifests);
    } catch (caught) {
      const isMissing = caught instanceof Error && "code" in caught && caught.code === "ENOENT";
      const isCorrupt = caught instanceof SyntaxError;
      if (isMissing || isCorrupt) {
        return emptyState;
      }
      throw caught;
    }
  }

  async function writeState(state: PersistedPluginState): Promise<void> {
    const normalizedState = normalizeState(state, manifests);
    const tempPath = `${statePath}.tmp`;
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(normalizedState, null, 2)}\n`, "utf8");
    await rename(tempPath, statePath);
  }

  return {
    async list() {
      const state = await readState();
      return buildPluginDescriptors(state.enabledPluginIds, manifests);
    },

    async getContributions() {
      const state = await readState();
      return getEnabledPluginContributions(state.enabledPluginIds, manifests);
    },

    async setEnabled(pluginId: string, enabled: boolean) {
      if (!knownIds.has(pluginId)) {
        throw new Error(`Unknown plugin: ${pluginId}`);
      }

      return enqueueMutation(async () => {
        const state = await readState();
        const enabledIds = new Set(state.enabledPluginIds);
        if (enabled) {
          enabledIds.add(pluginId);
        } else {
          enabledIds.delete(pluginId);
        }

        const enabledPluginIds = sortEnabledIds([...enabledIds], manifests);
        await writeState({
          enabledPluginIds
        });

        return buildPluginDescriptors(enabledPluginIds, manifests);
      });
    }
  };
}
