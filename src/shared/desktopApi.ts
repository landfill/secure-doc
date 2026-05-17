import type { PluginContributions, PluginDescriptor } from "./plugins";

export interface PublishHistoryRecord {
  documentId: string;
  title: string;
  issuer: string;
  issuedAt: string;
  displayExpiresAt?: string;
  packageSha256: string;
  kdf: "PBKDF2-HMAC-SHA-256";
  iterations: number;
  contentAlg: "AES-256-GCM";
  createdBy: string;
  outputPath: string;
  platform: string;
}

export interface SavePackageRequest {
  suggestedFileName: string;
  html: string;
  history: Omit<PublishHistoryRecord, "packageSha256" | "outputPath" | "platform">;
}

export interface SavePackageResult {
  canceled: boolean;
  filePath?: string;
  packageSha256?: string;
}

export interface SmtpSettingsView {
  pluginId: "delivery.smtp.gmail";
  host: string;
  port: number;
  senderEmail: string;
  hasAppPassword: boolean;
}

export interface SaveSmtpSettingsRequest {
  host: string;
  port: number;
  senderEmail: string;
  appPassword?: string;
}

export interface SendSmtpEmailRequest {
  documentId: string;
  outputPath: string;
  recipientEmail: string;
  subject: string;
  attachmentFileName: string;
}

export type SendSmtpHistoryEmailRequest = SendSmtpEmailRequest;

export interface SendSmtpEmailResult {
  sent: true;
  messageId?: string;
}

export interface SmtpConnectionTestResult {
  ok: true;
}

export type AuditPackageIntegrityStatus = "verified" | "missing" | "tampered";

export interface AuditPackageIntegrityRequest {
  documentId: string;
  outputPath: string;
}

export interface AuditPackageIntegrityReport {
  pluginId: "audit.integrity.report";
  actionId: "verify-package";
  documentId: string;
  title: string;
  issuer: string;
  issuedAt: string;
  displayExpiresAt?: string;
  packageSha256: string;
  kdf: "PBKDF2-HMAC-SHA-256";
  iterations: number;
  contentAlg: "AES-256-GCM";
  createdBy: string;
  outputPath: string;
  platform: string;
  checkedAt: string;
  status: AuditPackageIntegrityStatus;
  message: string;
}

export type PluginSettingsView = SmtpSettingsView;
export type SavePluginSettingsRequest = SaveSmtpSettingsRequest;
export type PluginActionResult = SmtpConnectionTestResult | SendSmtpEmailResult | AuditPackageIntegrityReport;

export interface SecureDocPluginApi {
  list(): Promise<PluginDescriptor[]>;
  setEnabled(pluginId: string, enabled: boolean): Promise<PluginDescriptor[]>;
  getContributions(): Promise<PluginContributions>;
  getSettings(pluginId: string): Promise<PluginSettingsView>;
  saveSettings(pluginId: string, values: SavePluginSettingsRequest): Promise<PluginSettingsView>;
  clearSettings(pluginId: string): Promise<PluginSettingsView>;
  runAction(pluginId: string, actionId: string, payload?: unknown): Promise<PluginActionResult>;
}

export interface SecureDocDesktopApi {
  savePackage(request: SavePackageRequest): Promise<SavePackageResult>;
  getHistory(): Promise<PublishHistoryRecord[]>;
  showItemInFolder(filePath: string): Promise<void>;
  plugins: SecureDocPluginApi;
}

