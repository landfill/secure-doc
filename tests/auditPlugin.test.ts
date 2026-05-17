import test from "node:test";
import assert from "node:assert/strict";
import { createAuditPluginService } from "../src/main/auditPlugin.ts";
import { sha256Base64Url } from "../src/main/packageIntegrity.ts";
import type { AuditPackageIntegrityReport, PublishHistoryRecord } from "../src/shared/desktopApi.ts";
import { AUDIT_INTEGRITY_HISTORY_ACTION_ID, AUDIT_INTEGRITY_PLUGIN_ID } from "../src/shared/plugins.ts";

function buildHistoryRecord(overrides: Partial<PublishHistoryRecord> = {}): PublishHistoryRecord {
  return {
    documentId: "doc-1",
    title: "Quarterly secure package",
    issuer: "Compliance",
    issuedAt: "2026-05-17T09:00:00.000Z",
    displayExpiresAt: "2026-06-01",
    packageSha256: sha256Base64Url("<!doctype html><title>Issued package</title>"),
    kdf: "PBKDF2-HMAC-SHA-256",
    iterations: 1_000_000,
    contentAlg: "AES-256-GCM",
    createdBy: "admin",
    outputPath: "C:\\secure\\doc-1.html",
    platform: "win32",
    ...overrides
  };
}

test("audit integrity action reports a verified saved package without exposing contents", async () => {
  const record = buildHistoryRecord();
  const service = createAuditPluginService({
    isPluginEnabled: async () => true,
    listHistory: async () => [record],
    readPackageFile: async () => "<!doctype html><title>Issued package</title>",
    now: () => new Date("2026-05-17T10:00:00.000Z")
  });

  const report = await service.runAction(AUDIT_INTEGRITY_PLUGIN_ID, AUDIT_INTEGRITY_HISTORY_ACTION_ID, {
    documentId: record.documentId,
    outputPath: record.outputPath
  });

  assert.deepEqual(report, {
    pluginId: AUDIT_INTEGRITY_PLUGIN_ID,
    actionId: AUDIT_INTEGRITY_HISTORY_ACTION_ID,
    documentId: "doc-1",
    title: "Quarterly secure package",
    issuer: "Compliance",
    issuedAt: "2026-05-17T09:00:00.000Z",
    displayExpiresAt: "2026-06-01",
    packageSha256: record.packageSha256,
    kdf: "PBKDF2-HMAC-SHA-256",
    iterations: 1_000_000,
    contentAlg: "AES-256-GCM",
    createdBy: "admin",
    outputPath: "C:\\secure\\doc-1.html",
    platform: "win32",
    checkedAt: "2026-05-17T10:00:00.000Z",
    status: "verified",
    message: "Saved secure HTML file matches publish history."
  });
  assert.equal(JSON.stringify(report).includes("Issued package"), false);
});

test("audit integrity action reports missing and tampered packages safely", async () => {
  const record = buildHistoryRecord();
  const missingService = createAuditPluginService({
    isPluginEnabled: async () => true,
    listHistory: async () => [record],
    readPackageFile: async () => {
      throw new Error("ENOENT");
    },
    now: () => new Date("2026-05-17T10:00:00.000Z")
  });
  const missingReport = (await missingService.runAction(AUDIT_INTEGRITY_PLUGIN_ID, AUDIT_INTEGRITY_HISTORY_ACTION_ID, {
    documentId: record.documentId,
    outputPath: record.outputPath
  })) as AuditPackageIntegrityReport;
  assert.equal(missingReport.status, "missing");
  assert.equal(missingReport.message, "Saved secure HTML file is missing.");

  const tamperedService = createAuditPluginService({
    isPluginEnabled: async () => true,
    listHistory: async () => [record],
    readPackageFile: async () =>
      "<!doctype html><body>Plain confidential body PIN 123456 PIN hash pinhash-abc DEK dek-secret KEK kek-secret</body>",
    now: () => new Date("2026-05-17T10:00:00.000Z")
  });
  const tamperedReport = (await tamperedService.runAction(AUDIT_INTEGRITY_PLUGIN_ID, AUDIT_INTEGRITY_HISTORY_ACTION_ID, {
    documentId: record.documentId,
    outputPath: record.outputPath
  })) as AuditPackageIntegrityReport;
  const serializedReport = JSON.stringify(tamperedReport);

  assert.equal(tamperedReport.status, "tampered");
  assert.equal(tamperedReport.message, "Saved secure HTML file hash differs from publish history.");
  assert.equal(serializedReport.includes("Plain confidential body"), false);
  assert.equal(serializedReport.includes("123456"), false);
  assert.equal(serializedReport.includes("pinhash-abc"), false);
  assert.equal(serializedReport.includes("dek-secret"), false);
  assert.equal(serializedReport.includes("kek-secret"), false);
});

test("audit plugin rejects disabled or unknown action requests", async () => {
  const record = buildHistoryRecord();
  const service = createAuditPluginService({
    isPluginEnabled: async () => false,
    listHistory: async () => [record]
  });

  await assert.rejects(
    () =>
      service.runAction(AUDIT_INTEGRITY_PLUGIN_ID, AUDIT_INTEGRITY_HISTORY_ACTION_ID, {
        documentId: record.documentId,
        outputPath: record.outputPath
      }),
    /disabled/
  );

  const enabledService = createAuditPluginService({
    isPluginEnabled: async () => true,
    listHistory: async () => [record]
  });

  await assert.rejects(() => enabledService.runAction(AUDIT_INTEGRITY_PLUGIN_ID, "unknown-action"), /Unknown plugin action/);
  await assert.rejects(
    () =>
      enabledService.runAction(AUDIT_INTEGRITY_PLUGIN_ID, AUDIT_INTEGRITY_HISTORY_ACTION_ID, {
        documentId: "missing-doc",
        outputPath: record.outputPath
      }),
    /not available/
  );
});
