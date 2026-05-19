import test from "node:test";
import assert from "node:assert/strict";
import { createPackageIntegrityAuditService } from "../src/main/packageIntegrityAudit.ts";
import { sha256Base64Url } from "../src/main/packageIntegrity.ts";
import type { PackageIntegrityReport, PublishHistoryRecord } from "../src/shared/desktopApi.ts";

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

test("core package integrity audit reports a verified saved package without exposing contents", async () => {
  const record = buildHistoryRecord();
  const service = createPackageIntegrityAuditService({
    listHistory: async () => [record],
    readPackageFile: async () => "<!doctype html><title>Issued package</title>",
    now: () => new Date("2026-05-17T10:00:00.000Z")
  });

  const report = await service.verifyPackageIntegrity({
    documentId: record.documentId,
    outputPath: record.outputPath
  });

  assert.deepEqual(report, {
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
    message: "저장된 보안 HTML 파일이 발행 이력과 일치합니다."
  });
  assert.equal(JSON.stringify(report).includes("Issued package"), false);
  assert.equal("pluginId" in report, false);
  assert.equal("actionId" in report, false);
});

test("core package integrity audit reports missing and tampered packages safely", async () => {
  const record = buildHistoryRecord();
  const missingService = createPackageIntegrityAuditService({
    listHistory: async () => [record],
    readPackageFile: async () => {
      throw new Error("ENOENT");
    },
    now: () => new Date("2026-05-17T10:00:00.000Z")
  });
  const missingReport = (await missingService.verifyPackageIntegrity({
    documentId: record.documentId,
    outputPath: record.outputPath
  })) as PackageIntegrityReport;
  assert.equal(missingReport.status, "missing");
  assert.equal(missingReport.message, "저장된 보안 HTML 파일을 찾을 수 없습니다.");

  const tamperedService = createPackageIntegrityAuditService({
    listHistory: async () => [record],
    readPackageFile: async () =>
      "<!doctype html><body>Plain confidential body PIN 123456 PIN hash pinhash-abc DEK dek-secret KEK kek-secret</body>",
    now: () => new Date("2026-05-17T10:00:00.000Z")
  });
  const tamperedReport = (await tamperedService.verifyPackageIntegrity({
    documentId: record.documentId,
    outputPath: record.outputPath
  })) as PackageIntegrityReport;
  const serializedReport = JSON.stringify(tamperedReport);

  assert.equal(tamperedReport.status, "tampered");
  assert.equal(tamperedReport.message, "저장된 보안 HTML 파일의 해시가 발행 이력과 다릅니다.");
  assert.equal(serializedReport.includes("Plain confidential body"), false);
  assert.equal(serializedReport.includes("123456"), false);
  assert.equal(serializedReport.includes("pinhash-abc"), false);
  assert.equal(serializedReport.includes("dek-secret"), false);
  assert.equal(serializedReport.includes("kek-secret"), false);
});

test("core package integrity audit rejects invalid or unavailable history requests", async () => {
  const record = buildHistoryRecord();
  const service = createPackageIntegrityAuditService({
    listHistory: async () => [record]
  });

  await assert.rejects(
    () =>
      service.verifyPackageIntegrity({
        documentId: "missing-doc",
        outputPath: record.outputPath
      }),
    /사용할 수 없습니다/
  );

  await assert.rejects(() => service.verifyPackageIntegrity({ documentId: "", outputPath: "" }), /발행 이력 항목/);
});
