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
    throw new Error("Audit request is required.");
  }

  const documentId = typeof payload.documentId === "string" ? payload.documentId.trim() : "";
  const outputPath = typeof payload.outputPath === "string" ? payload.outputPath.trim() : "";

  if (!documentId || !outputPath) {
    throw new Error("Publish history item is required.");
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
      throw new Error("Audit plugin is disabled.");
    }
  }

  async function verifyPackageIntegrity(payload: unknown): Promise<AuditPackageIntegrityReport> {
    const request = normalizeAuditPackageIntegrityRequest(payload);
    const record = (await listHistory()).find(
      (item) => item.documentId === request.documentId && item.outputPath === request.outputPath
    );
    if (!record) {
      throw new Error("Selected publish history item is not available for audit report.");
    }

    const checkedAt = now().toISOString();
    let packageHtml: string;
    try {
      packageHtml = await readPackageFile(record.outputPath);
    } catch {
      return toReport(record, checkedAt, "missing", "Saved secure HTML file is missing.");
    }

    try {
      assertPackageContentMatchesHash(packageHtml, record.packageSha256);
      return toReport(record, checkedAt, "verified", "Saved secure HTML file matches publish history.");
    } catch {
      return toReport(record, checkedAt, "tampered", "Saved secure HTML file hash differs from publish history.");
    }
  }

  return {
    async runAction(pluginId, actionId, payload) {
      if (pluginId !== AUDIT_INTEGRITY_PLUGIN_ID) {
        throw new Error(`Unknown plugin: ${pluginId}`);
      }
      await assertEnabled();

      if (actionId === AUDIT_INTEGRITY_HISTORY_ACTION_ID) {
        return verifyPackageIntegrity(payload);
      }

      throw new Error(`Unknown plugin action: ${actionId}`);
    }
  };
}
