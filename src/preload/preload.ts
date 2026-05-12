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
  }
};

contextBridge.exposeInMainWorld("secureDoc", api);

