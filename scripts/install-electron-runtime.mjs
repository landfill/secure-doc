import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let electronInstallPath;
try {
  electronInstallPath = require.resolve("electron/install.js");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "MODULE_NOT_FOUND") {
    console.log("Electron package is not installed; skipping Electron runtime download.");
    process.exit(0);
  }
  throw error;
}

const result = spawnSync(process.execPath, [electronInstallPath], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
