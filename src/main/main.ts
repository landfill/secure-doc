import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { createHistoryStore } from "./history";
import { createPluginStore } from "./pluginStore";
import { createGmailSmtpPluginService } from "./smtpPlugin";
import type { PublishHistoryRecord, SavePackageRequest, SavePackageResult } from "../shared/desktopApi";
import type { PluginContributions, PluginDescriptor } from "../shared/plugins";

let mainWindow: BrowserWindow | null = null;
const historyStorePromise = app.whenReady().then(() => createHistoryStore(app.getPath("userData")));
const pluginStorePromise = app.whenReady().then(() => createPluginStore(app.getPath("userData")));
const smtpPluginServicePromise = app.whenReady().then(() =>
  createGmailSmtpPluginService({
    userDataPath: app.getPath("userData"),
    secretCodec: safeStorage,
    async isPluginEnabled(pluginId) {
      const pluginStore = await pluginStorePromise;
      return (await pluginStore.list()).some((plugin) => plugin.id === pluginId && plugin.enabled);
    },
    async readHistoryAttachment(request) {
      const historyStore = await historyStorePromise;
      const historyRecord = (await historyStore.list()).find(
        (record) => record.documentId === request.documentId && record.outputPath === request.outputPath
      );
      if (!historyRecord) {
        throw new Error("Selected publish history item is not available for email delivery.");
      }

      try {
        return await readFile(historyRecord.outputPath, "utf8");
      } catch {
        throw new Error("Saved secure HTML file is no longer available. Recreate the package before sending email.");
      }
    }
  })
);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 1024,
    minHeight: 720,
    title: "Secure Doc Admin",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function safeSuggestedName(name: string): string {
  const trimmed = name.normalize("NFKC").trim().replace(/[\\/:*?"<>|]+/g, "-");
  return trimmed.endsWith(".html") ? trimmed : `${trimmed || "secure-document"}.html`;
}

ipcMain.handle("secure-doc:save-package", async (_event, request: SavePackageRequest): Promise<SavePackageResult> => {
  if (!mainWindow) {
    throw new Error("Main window is not available.");
  }

  const defaultPath = safeSuggestedName(request.suggestedFileName);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "암호화 HTML 문서 저장",
    defaultPath,
    filters: [
      {
        name: "HTML Document",
        extensions: ["html"]
      }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await mkdir(dirname(result.filePath), { recursive: true });
  await writeFile(result.filePath, request.html, "utf8");

  const packageSha256 = sha256Base64Url(request.html);
  const historyRecord: PublishHistoryRecord = {
    ...request.history,
    packageSha256,
    outputPath: result.filePath,
    platform: process.platform
  };
  const historyStore = await historyStorePromise;
  await historyStore.add(historyRecord);

  return {
    canceled: false,
    filePath: result.filePath,
    packageSha256
  };
});

ipcMain.handle("secure-doc:get-history", async (): Promise<PublishHistoryRecord[]> => {
  const historyStore = await historyStorePromise;
  return historyStore.list();
});

ipcMain.handle("secure-doc:show-item-in-folder", async (_event, filePath: string): Promise<void> => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle("secure-doc:plugins:list", async (): Promise<PluginDescriptor[]> => {
  const pluginStore = await pluginStorePromise;
  return pluginStore.list();
});

ipcMain.handle("secure-doc:plugins:get-contributions", async (): Promise<PluginContributions> => {
  const pluginStore = await pluginStorePromise;
  return pluginStore.getContributions();
});

ipcMain.handle(
  "secure-doc:plugins:set-enabled",
  async (_event, pluginId: string, enabled: boolean): Promise<PluginDescriptor[]> => {
    if (typeof pluginId !== "string" || typeof enabled !== "boolean") {
      throw new Error("Invalid plugin toggle request.");
    }

    const pluginStore = await pluginStorePromise;
    return pluginStore.setEnabled(pluginId, enabled);
  }
);

ipcMain.handle("secure-doc:plugins:get-settings", async (_event, pluginId: string) => {
  if (typeof pluginId !== "string") {
    throw new Error("Invalid plugin settings request.");
  }

  const smtpPluginService = await smtpPluginServicePromise;
  return smtpPluginService.getSettings(pluginId);
});

ipcMain.handle("secure-doc:plugins:save-settings", async (_event, pluginId: string, values: unknown) => {
  if (typeof pluginId !== "string") {
    throw new Error("Invalid plugin settings save request.");
  }

  const smtpPluginService = await smtpPluginServicePromise;
  return smtpPluginService.saveSettings(pluginId, values);
});

ipcMain.handle("secure-doc:plugins:clear-settings", async (_event, pluginId: string) => {
  if (typeof pluginId !== "string") {
    throw new Error("Invalid plugin settings clear request.");
  }

  const smtpPluginService = await smtpPluginServicePromise;
  return smtpPluginService.clearSettings(pluginId);
});

ipcMain.handle("secure-doc:plugins:run-action", async (_event, pluginId: string, actionId: string, payload?: unknown) => {
  if (typeof pluginId !== "string" || typeof actionId !== "string") {
    throw new Error("Invalid plugin action request.");
  }

  const smtpPluginService = await smtpPluginServicePromise;
  return smtpPluginService.runAction(pluginId, actionId, payload);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
