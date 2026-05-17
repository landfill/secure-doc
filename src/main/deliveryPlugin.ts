import type { PublishHistoryRecord } from "../shared/desktopApi.ts";
import { assertPackageContentMatchesHash } from "./packageIntegrity.ts";

export interface DeliveryPackagePayload {
  documentId: string;
  outputPath: string;
  attachmentFileName: string;
}

export interface VerifiedHistoryPackageReaderOptions {
  listHistory(): Promise<PublishHistoryRecord[]>;
  readPackageFile(outputPath: string): Promise<string>;
  unavailableMessage: string;
  missingFileMessage: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeDeliveryPackagePayload(payload: unknown): DeliveryPackagePayload {
  if (!isRecord(payload)) {
    throw new Error("Delivery request is required.");
  }

  const documentId = typeof payload.documentId === "string" ? payload.documentId.trim() : "";
  const outputPath = typeof payload.outputPath === "string" ? payload.outputPath.trim() : "";
  const attachmentFileName = typeof payload.attachmentFileName === "string" ? payload.attachmentFileName.trim() : "";

  if (!documentId || !outputPath) {
    throw new Error("Saved secure package is required.");
  }
  if (!attachmentFileName.endsWith(".html") || /[\\/]/.test(attachmentFileName)) {
    throw new Error("Attachment file name must be a local .html file name.");
  }

  return {
    documentId,
    outputPath,
    attachmentFileName
  };
}

export function createVerifiedHistoryPackageReader({
  listHistory,
  readPackageFile,
  unavailableMessage,
  missingFileMessage
}: VerifiedHistoryPackageReaderOptions): (request: DeliveryPackagePayload) => Promise<string> {
  return async (request) => {
    const historyRecord = (await listHistory()).find(
      (record) => record.documentId === request.documentId && record.outputPath === request.outputPath
    );
    if (!historyRecord) {
      throw new Error(unavailableMessage);
    }

    let packageHtml: string;
    try {
      packageHtml = await readPackageFile(historyRecord.outputPath);
    } catch {
      throw new Error(missingFileMessage);
    }

    assertPackageContentMatchesHash(packageHtml, historyRecord.packageSha256);
    return packageHtml;
  };
}
