import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { createHistoryStore } from "./history";
import type { PublishHistoryRecord, SavePackageRequest, SavePackageResult } from "../shared/desktopApi";

let mainWindow: BrowserWindow | null = null;
const historyStorePromise = app.whenReady().then(() => createHistoryStore(app.getPath("userData")));

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 1024,
    minHeight: 720,
    title: "Secure Doc Admin",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
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

