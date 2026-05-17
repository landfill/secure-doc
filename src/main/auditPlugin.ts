import { readFile } from "node:fs/promises";
import {
  type AuditPackageIntegrityReport,
  type AuditPackageIntegrityRequest,
  type PluginActionResult,
  type PublishHistoryRecord
} from "../shared/desktopApi.ts";
import { assertPackageContentMatchesHash } from "./packageIntegrity.ts";
import { AUDIT_INTEGRITY_HISTORY_ACTION_ID, AUDIT_INTEGRITY_PLUGIN_ID } from "../shared/plugins.ts";

export interface AuditPluginServiceOptions {
  isPluginEnabled(pluginId: string): Promise<boolean>;
  listHistory(): Promise<PublishHistoryRecord[]>;
  readPackageFile?: (filePath: string) => Promise<string>;
  now?: () => Date;
}

export interface AuditPluginService {
  runAction(pluginId: string, actionId: string, payload?: unknown): Promise<PluginActionResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAuditPackageIntegrityRequest(payload: unknown): AuditPackageIntegrityRequest {
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
  status: AuditPackageIntegrityReport["status"],
  message: string
): AuditPackageIntegrityReport {
  return {
    pluginId: AUDIT_INTEGRITY_PLUGIN_ID,
    actionId: AUDIT_INTEGRITY_HISTORY_ACTION_ID,
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

export function createAuditPluginService({
  isPluginEnabled,
  listHistory,
  readPackageFile = (filePath) => readFile(filePath, "utf8"),
  now = () => new Date()
}: AuditPluginServiceOptions): AuditPluginService {
  async function assertEnabled(): Promise<void> {
    if (!(await isPluginEnabled(AUDIT_INTEGRITY_PLUGIN_ID))) {
      throw new Error("감사 플러그인이 비활성화되어 있습니다.");
    }
  }

  async function verifyPackageIntegrity(payload: unknown): Promise<AuditPackageIntegrityReport> {
    const request = normalizeAuditPackageIntegrityRequest(payload);
    const record = (await listHistory()).find(
      (item) => item.documentId === request.documentId && item.outputPath === request.outputPath
    );
    if (!record) {
      throw new Error("선택한 발행 이력 항목을 감사 리포트에서 사용할 수 없습니다.");
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

  return {
    async runAction(pluginId, actionId, payload) {
      if (pluginId !== AUDIT_INTEGRITY_PLUGIN_ID) {
        throw new Error(`알 수 없는 플러그인입니다: ${pluginId}`);
      }
      await assertEnabled();

      if (actionId === AUDIT_INTEGRITY_HISTORY_ACTION_ID) {
        return verifyPackageIntegrity(payload);
      }

      throw new Error(`알 수 없는 플러그인 액션입니다: ${actionId}`);
    }
  };
}
