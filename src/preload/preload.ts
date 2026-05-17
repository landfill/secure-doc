import { contextBridge, ipcRenderer } from "electron";
import type { SavePackageRequest, SavePackageResult, SecureDocDesktopApi } from "../shared/desktopApi";

const api: SecureDocDesktopApi = {
  savePackage(request: SavePackageRequest): Promise<SavePackageResult> {
    return ipcRenderer.invoke("secure-doc:save-package", request);
  },
  getHistory() {
    return ipcRenderer.invoke("secure-doc:get-history");
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
    }
  }
};

contextBridge.exposeInMainWorld("secureDoc", api);

