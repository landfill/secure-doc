import test from "node:test";
import assert from "node:assert/strict";
import { createVerifiedHistoryPackageReader, normalizeDeliveryPackagePayload } from "../src/main/deliveryPlugin.ts";
import { sha256Base64Url } from "../src/main/packageIntegrity.ts";
import type { PublishHistoryRecord } from "../src/shared/desktopApi.ts";

const packageHtml = "<!doctype html><title>Issued package</title>";
const record: PublishHistoryRecord = {
  documentId: "doc-1",
  title: "Issued package",
  issuer: "Issuer",
  issuedAt: "2026-05-17T00:00:00.000Z",
  packageSha256: sha256Base64Url(packageHtml),
  kdf: "PBKDF2-HMAC-SHA-256",
  iterations: 600_000,
  contentAlg: "AES-256-GCM",
  createdBy: "admin",
  outputPath: "C:\\secure\\doc-1.html",
  platform: "win32"
};

test("delivery payloads reference only saved package identity and attachment name", () => {
  assert.deepEqual(
    normalizeDeliveryPackagePayload({
      documentId: " doc-1 ",
      outputPath: " C:\\secure\\doc-1.html ",
      attachmentFileName: "doc-1.html"
    }),
    {
      documentId: "doc-1",
      outputPath: "C:\\secure\\doc-1.html",
      attachmentFileName: "doc-1.html"
    }
  );

  assert.throws(
    () =>
      normalizeDeliveryPackagePayload({
        documentId: "doc-1",
        outputPath: "C:\\secure\\doc-1.html",
        attachmentFileName: "..\\doc-1.html"
      }),
    /local \.html file name/
  );
});

test("verified history package reader resolves history and checks package hash", async () => {
  const reader = createVerifiedHistoryPackageReader({
    listHistory: async () => [record],
    readPackageFile: async (outputPath) => {
      assert.equal(outputPath, record.outputPath);
      return packageHtml;
    },
    unavailableMessage: "history missing",
    missingFileMessage: "file missing"
  });

  assert.equal(
    await reader({
      documentId: record.documentId,
      outputPath: record.outputPath,
      attachmentFileName: "doc-1.html"
    }),
    packageHtml
  );
});

test("verified history package reader fails closed on missing or tampered packages", async () => {
  const missingHistoryReader = createVerifiedHistoryPackageReader({
    listHistory: async () => [],
    readPackageFile: async () => packageHtml,
    unavailableMessage: "history missing",
    missingFileMessage: "file missing"
  });

  await assert.rejects(
    () =>
      missingHistoryReader({
        documentId: record.documentId,
        outputPath: record.outputPath,
        attachmentFileName: "doc-1.html"
      }),
    /history missing/
  );

  const tamperedReader = createVerifiedHistoryPackageReader({
    listHistory: async () => [record],
    readPackageFile: async () => "<!doctype html><title>Tampered</title>",
    unavailableMessage: "history missing",
    missingFileMessage: "file missing"
  });

  await assert.rejects(
    () =>
      tamperedReader({
        documentId: record.documentId,
        outputPath: record.outputPath,
        attachmentFileName: "doc-1.html"
      }),
    /no longer matches/
  );
});
