import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHistoryStore } from "../src/main/history.ts";
import type { PublishHistoryRecord } from "../src/shared/desktopApi.ts";

function buildHistoryRecord(overrides: Partial<PublishHistoryRecord> = {}): PublishHistoryRecord {
  return {
    documentId: "doc-history-i18n",
    title: "Localized viewer package",
    issuer: "Secure Doc Team",
    issuedAt: "2026-05-19T12:00:00.000Z",
    displayExpiresAt: "2026-06-19",
    packageSha256: "package-hash",
    kdf: "PBKDF2-HMAC-SHA-256",
    iterations: 1_000_000,
    contentAlg: "AES-256-GCM",
    createdBy: "admin",
    outputPath: "C:\\secure\\localized.html",
    platform: "win32",
    viewerLanguage: "en",
    ...overrides
  };
}

test("history store preserves per-document viewer language", async () => {
  const userDataPath = await mkdtemp(join(tmpdir(), "secure-doc-history-"));
  let store: Awaited<ReturnType<typeof createHistoryStore>> | undefined;
  try {
    store = await createHistoryStore(userDataPath);
    await store.add(buildHistoryRecord());

    const [record] = await store.list();

    assert.equal(record.viewerLanguage, "en");
  } finally {
    store?.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});

test("SQLite history store migrates older databases before saving viewer language", async () => {
  const sqlite = await import("node:sqlite").catch(() => null);
  if (!sqlite) {
    return;
  }

  const userDataPath = await mkdtemp(join(tmpdir(), "secure-doc-history-migration-"));
  let store: Awaited<ReturnType<typeof createHistoryStore>> | undefined;
  try {
    const db = new sqlite.DatabaseSync(join(userDataPath, "publish-history.sqlite"));
    db.exec(`
      CREATE TABLE publish_history (
        document_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        issuer TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        display_expires_at TEXT,
        package_sha256 TEXT NOT NULL,
        kdf TEXT NOT NULL,
        iterations INTEGER NOT NULL,
        content_alg TEXT NOT NULL,
        created_by TEXT NOT NULL,
        output_path TEXT NOT NULL,
        platform TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.close();

    store = await createHistoryStore(userDataPath);
    await store.add(buildHistoryRecord({ documentId: "doc-migrated-history" }));

    const [record] = await store.list();

    assert.equal(record.viewerLanguage, "en");
  } finally {
    store?.close();
    await rm(userDataPath, { recursive: true, force: true });
  }
});
