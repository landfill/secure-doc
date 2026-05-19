import { readFile } from "node:fs/promises";
import {
  type PackageIntegrityReport,
  type PackageIntegrityRequest,
  type PublishHistoryRecord
} from "../shared/desktopApi.ts";
import { DEFAULT_LOCALE, resolveLocale, translate, type Locale } from "../shared/i18n.ts";
import { assertPackageContentMatchesHash } from "./packageIntegrity.ts";

export interface PackageIntegrityAuditServiceOptions {
  listHistory(): Promise<PublishHistoryRecord[]>;
  readPackageFile?: (filePath: string) => Promise<string>;
  now?: () => Date;
}

export interface PackageIntegrityAuditService {
  verifyPackageIntegrity(payload: unknown): Promise<PackageIntegrityReport>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePackageIntegrityRequest(payload: unknown): PackageIntegrityRequest {
  if (!isRecord(payload)) {
    throw new Error(translate(DEFAULT_LOCALE, "history.auditRequestRequired"));
  }

  const documentId = typeof payload.documentId === "string" ? payload.documentId.trim() : "";
  const outputPath = typeof payload.outputPath === "string" ? payload.outputPath.trim() : "";
  const language = resolveLocale(payload.language);

  if (!documentId || !outputPath) {
    throw new Error(translate(language, "history.auditHistoryItemRequired"));
  }

  return {
    documentId,
    outputPath,
    language
  };
}

function toReport(
  record: PublishHistoryRecord,
  checkedAt: string,
  status: PackageIntegrityReport["status"],
  message: string
): PackageIntegrityReport {
  return {
    documentId: record.documentId,
    title: record.title,
    issuer: record.issuer,
    issuedAt: record.issuedAt,
    displayExpiresAt: record.displayExpiresAt,
    packageSha256: record.packageSha256,
    kdf: record.kdf,
    iterations: record.iterations,
    contentAlg: record.contentAlg,
    createdBy: record.createdBy,
    outputPath: record.outputPath,
    platform: record.platform,
    checkedAt,
    status,
    message
  };
}

export function createPackageIntegrityAuditService({
  listHistory,
  readPackageFile = (filePath) => readFile(filePath, "utf8"),
  now = () => new Date()
}: PackageIntegrityAuditServiceOptions): PackageIntegrityAuditService {
  return {
    async verifyPackageIntegrity(payload) {
      const request = normalizePackageIntegrityRequest(payload);
      const record = (await listHistory()).find(
        (item) => item.documentId === request.documentId && item.outputPath === request.outputPath
      );
      if (!record) {
        throw new Error(translate(request.language ?? DEFAULT_LOCALE, "history.auditHistoryUnavailable"));
      }

      const locale: Locale = request.language ?? DEFAULT_LOCALE;
      const checkedAt = now().toISOString();
      let packageHtml: string;
      try {
        packageHtml = await readPackageFile(record.outputPath);
      } catch {
        return toReport(record, checkedAt, "missing", translate(locale, "history.auditFileMissing"));
      }

      try {
        assertPackageContentMatchesHash(packageHtml, record.packageSha256);
        return toReport(record, checkedAt, "verified", translate(locale, "history.auditFileVerified"));
      } catch {
        return toReport(record, checkedAt, "tampered", translate(locale, "history.auditFileTampered"));
      }
    }
  };
}
