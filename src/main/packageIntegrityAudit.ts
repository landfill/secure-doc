import { readFile } from "node:fs/promises";
import {
  type PackageIntegrityReport,
  type PackageIntegrityRequest,
  type PublishHistoryRecord
} from "../shared/desktopApi.ts";
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
    throw new Error("감사 요청 정보가 필요합니다.");
  }

  const documentId = typeof payload.documentId === "string" ? payload.documentId.trim() : "";
  const outputPath = typeof payload.outputPath === "string" ? payload.outputPath.trim() : "";

  if (!documentId || !outputPath) {
    throw new Error("발행 이력 항목이 필요합니다.");
  }

  return {
    documentId,
    outputPath
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
        throw new Error("선택한 발행 이력 항목은 무결성 검증에 사용할 수 없습니다.");
      }

      const checkedAt = now().toISOString();
      let packageHtml: string;
      try {
        packageHtml = await readPackageFile(record.outputPath);
      } catch {
        return toReport(record, checkedAt, "missing", "저장된 보안 HTML 파일을 찾을 수 없습니다.");
      }

      try {
        assertPackageContentMatchesHash(packageHtml, record.packageSha256);
        return toReport(record, checkedAt, "verified", "저장된 보안 HTML 파일이 발행 이력과 일치합니다.");
      } catch {
        return toReport(record, checkedAt, "tampered", "저장된 보안 HTML 파일의 해시가 발행 이력과 다릅니다.");
      }
    }
  };
}
