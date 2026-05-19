import type { PluginContributions, PluginDescriptor, SmtpDeliveryPluginId } from "./plugins";
import type { Locale } from "./i18n";

export interface AppPreferences {
  language: Locale;
}

export interface AppInfo {
  name: string;
  version: string;
}

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
  viewerLanguage?: Locale;
}

export interface SavePackageRequest {
  suggestedFileName: string;
  html: string;
  history: Omit<PublishHistoryRecord, "packageSha256" | "outputPath" | "platform">;
  language?: Locale;
}

export interface SavePackageResult {
  canceled: boolean;
  filePath?: string;
  packageSha256?: string;
}

export interface SmtpSettingsView {
  pluginId: SmtpDeliveryPluginId;
  host: string;
  port: number;
  senderEmail: string;
  username: string;
  secure: boolean;
  requireTLS: boolean;
  hasPassword: boolean;
  hasAppPassword: boolean;
}

export interface SaveSmtpSettingsRequest {
  host: string;
  port: number;
  senderEmail: string;
  username?: string;
  secure?: boolean;
  requireTLS?: boolean;
  password?: string;
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

export type PackageIntegrityStatus = "verified" | "missing" | "tampered";

export interface PackageIntegrityRequest {
  documentId: string;
  outputPath: string;
  language?: Locale;
}

export interface PackageIntegrityReport {
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
  status: PackageIntegrityStatus;
  message: string;
}

export type PluginSettingsView = SmtpSettingsView;
export type SavePluginSettingsRequest = SaveSmtpSettingsRequest;
export type PluginActionResult = SmtpConnectionTestResult | SendSmtpEmailResult;

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
  getAppInfo(): Promise<AppInfo>;
  getPreferences(): Promise<AppPreferences>;
  savePreferences(preferences: AppPreferences): Promise<AppPreferences>;
  savePackage(request: SavePackageRequest): Promise<SavePackageResult>;
  getHistory(): Promise<PublishHistoryRecord[]>;
  verifyPackageIntegrity(request: PackageIntegrityRequest): Promise<PackageIntegrityReport>;
  showItemInFolder(filePath: string): Promise<void>;
  plugins: SecureDocPluginApi;
}

