import { contextBridge, ipcRenderer } from "electron";
import type {
  AppPreferences,
  PackageIntegrityReport,
  PackageIntegrityRequest,
  SavePackageRequest,
  SavePackageResult,
  SecureDocDesktopApi
} from "../shared/desktopApi";

const api: SecureDocDesktopApi = {
  getPreferences(): Promise<AppPreferences> {
    return ipcRenderer.invoke("secure-doc:get-preferences");
  },
  savePreferences(preferences: AppPreferences): Promise<AppPreferences> {
    return ipcRenderer.invoke("secure-doc:save-preferences", preferences);
  },
  savePackage(request: SavePackageRequest): Promise<SavePackageResult> {
    return ipcRenderer.invoke("secure-doc:save-package", request);
  },
  getHistory() {
    return ipcRenderer.invoke("secure-doc:get-history");
  },
  verifyPackageIntegrity(request: PackageIntegrityRequest): Promise<PackageIntegrityReport> {
    return ipcRenderer.invoke("secure-doc:verify-package-integrity", request);
  },
  showItemInFolder(filePath: string) {
    return ipcRenderer.invoke("secure-doc:show-item-in-folder", filePath);
  },
  plugins: {
    list() {
      return ipcRenderer.invoke("secure-doc:plugins:list");
    },
    setEnabled(pluginId: string, enabled: boolean) {
      return ipcRenderer.invoke("secure-doc:plugins:set-enabled", pluginId, enabled);
    },
    getContributions() {
      return ipcRenderer.invoke("secure-doc:plugins:get-contributions");
    },
    getSettings(pluginId: string) {
      return ipcRenderer.invoke("secure-doc:plugins:get-settings", pluginId);
    },
    saveSettings(pluginId: string, values) {
      return ipcRenderer.invoke("secure-doc:plugins:save-settings", pluginId, values);
    },
    clearSettings(pluginId: string) {
      return ipcRenderer.invoke("secure-doc:plugins:clear-settings", pluginId);
    },
    runAction(pluginId: string, actionId: string, payload?: unknown) {
      return ipcRenderer.invoke("secure-doc:plugins:run-action", pluginId, actionId, payload);
    }
  }
};

contextBridge.exposeInMainWorld("secureDoc", api);

