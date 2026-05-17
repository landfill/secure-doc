import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import nodemailer from "nodemailer";
import type {
  PluginActionResult,
  SaveSmtpSettingsRequest,
  SendSmtpEmailRequest,
  SendSmtpHistoryEmailRequest,
  SendSmtpEmailResult,
  SmtpConnectionTestResult,
  SmtpSettingsView
} from "../shared/desktopApi.ts";
import {
  GMAIL_SMTP_HISTORY_SEND_ACTION_ID,
  GMAIL_SMTP_PLUGIN_ID,
  GMAIL_SMTP_SEND_ACTION_ID,
  GMAIL_SMTP_TEST_ACTION_ID
} from "../shared/plugins.ts";

interface PersistedSmtpSettings {
  host: string;
  port: number;
  senderEmail: string;
  encryptedAppPassword?: string;
}

interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface SmtpMailOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  attachments: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
}

interface PreparedSmtpEmailRequest {
  recipientEmail: string;
  subject: string;
  attachmentFileName: string;
  attachmentHtml: string;
}

interface SmtpTransportContext {
  senderEmail: string;
  transport: SmtpTransport;
}

export interface SmtpTransport {
  verify(): Promise<unknown>;
  sendMail(options: SmtpMailOptions): Promise<{ messageId?: string }>;
}

export interface SmtpSecretCodec {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface GmailSmtpPluginServiceOptions {
  userDataPath: string;
  secretCodec: SmtpSecretCodec;
  isPluginEnabled(pluginId: string): Promise<boolean>;
  readHistoryAttachment?: (request: SendSmtpHistoryEmailRequest) => Promise<string>;
  createTransport?: (options: SmtpTransportOptions) => SmtpTransport;
}

export interface GmailSmtpPluginService {
  getSettings(pluginId: string): Promise<SmtpSettingsView>;
  saveSettings(pluginId: string, values: unknown): Promise<SmtpSettingsView>;
  clearSettings(pluginId: string): Promise<SmtpSettingsView>;
  runAction(pluginId: string, actionId: string, payload?: unknown): Promise<PluginActionResult>;
}

const defaultHost = "smtp.gmail.com";
const defaultPort = 587;
const settingsFileName = `${GMAIL_SMTP_PLUGIN_ID}.json`;

const emptySettingsView: SmtpSettingsView = {
  pluginId: GMAIL_SMTP_PLUGIN_ID,
  host: defaultHost,
  port: defaultPort,
  senderEmail: "",
  hasAppPassword: false
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeSmtpAppPassword(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

export function normalizeSmtpHost(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("SMTP host must be a hostname.");
  }

  const host = value.normalize("NFKC").trim().toLowerCase();
  if (
    !host ||
    host.length > 255 ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    host.includes("..")
  ) {
    throw new Error("SMTP host must be a hostname.");
  }

  return host;
}

export function normalizeSmtpPort(value: unknown): number {
  const port = typeof value === "number" ? value : Number(value);
  if (port !== 587) {
    throw new Error("Gmail SMTP port must be 587 for STARTTLS.");
  }
  return port;
}

export function normalizeSmtpEmail(value: unknown, fieldLabel = "Email address"): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldLabel} is required.`);
  }

  const email = value.normalize("NFKC").trim();
  if (!email || email.length > 254 || /\s/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    throw new Error(`${fieldLabel} must be a valid email address.`);
  }

  return email;
}

export function validateSmtpAppPassword(value: string): string {
  const appPassword = normalizeSmtpAppPassword(value);
  if (appPassword.length !== 16) {
    throw new Error("Gmail app password must be 16 characters after removing spaces.");
  }
  return appPassword;
}

export function toSafeSmtpError(caught: unknown): string {
  const code = isRecord(caught) && typeof caught.code === "string" ? caught.code : "";
  const responseCode = isRecord(caught) && typeof caught.responseCode === "number" ? caught.responseCode : 0;

  if (responseCode === 534 || responseCode === 535 || code === "EAUTH") {
    return "SMTP authentication failed. Check the Gmail account and app password.";
  }

  if (["ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ESOCKET"].includes(code)) {
    return "SMTP network connection failed. Check the host, port, and network connection.";
  }

  return "SMTP request failed. Check the Gmail SMTP settings and try again.";
}

function normalizePersistedSettings(value: unknown): PersistedSmtpSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  try {
    const encryptedAppPassword =
      typeof value.encryptedAppPassword === "string" && value.encryptedAppPassword.trim()
        ? value.encryptedAppPassword
        : undefined;
    return {
      host: normalizeSmtpHost(value.host),
      port: normalizeSmtpPort(value.port),
      senderEmail: normalizeSmtpEmail(value.senderEmail, "Sender email"),
      encryptedAppPassword
    };
  } catch {
    return null;
  }
}

function toSettingsView(settings: PersistedSmtpSettings | null): SmtpSettingsView {
  if (!settings) {
    return emptySettingsView;
  }

  return {
    pluginId: GMAIL_SMTP_PLUGIN_ID,
    host: settings.host,
    port: settings.port,
    senderEmail: settings.senderEmail,
    hasAppPassword: Boolean(settings.encryptedAppPassword)
  };
}

function assertKnownPlugin(pluginId: string): void {
  if (pluginId !== GMAIL_SMTP_PLUGIN_ID) {
    throw new Error(`Unknown plugin: ${pluginId}`);
  }
}

function normalizeSaveRequest(values: unknown): SaveSmtpSettingsRequest {
  if (!isRecord(values)) {
    throw new Error("SMTP settings are required.");
  }

  const appPassword = typeof values.appPassword === "string" ? values.appPassword : undefined;
  return {
    host: normalizeSmtpHost(values.host),
    port: normalizeSmtpPort(values.port),
    senderEmail: normalizeSmtpEmail(values.senderEmail, "Sender email"),
    appPassword
  };
}

function normalizeSendRequest(payload: unknown): SendSmtpEmailRequest {
  if (!isRecord(payload)) {
    throw new Error("Email send request is required.");
  }

  const documentId = typeof payload.documentId === "string" ? payload.documentId.trim() : "";
  const outputPath = typeof payload.outputPath === "string" ? payload.outputPath.trim() : "";
  const attachmentFileName = typeof payload.attachmentFileName === "string" ? payload.attachmentFileName.trim() : "";
  const subject = typeof payload.subject === "string" ? payload.subject.normalize("NFKC").trim() : "";

  if (!documentId || !outputPath) {
    throw new Error("Saved secure package is required.");
  }
  if (!attachmentFileName.endsWith(".html")) {
    throw new Error("Attachment file name must end with .html.");
  }
  if (!subject) {
    throw new Error("Email subject is required.");
  }

  return {
    documentId,
    outputPath,
    recipientEmail: normalizeSmtpEmail(payload.recipientEmail, "Recipient email"),
    subject,
    attachmentFileName
  };
}

function normalizeHistorySendRequest(payload: unknown): SendSmtpHistoryEmailRequest {
  return normalizeSendRequest(payload);
}

function createDefaultTransport(options: SmtpTransportOptions): SmtpTransport {
  return nodemailer.createTransport(options) as SmtpTransport;
}

export function createGmailSmtpPluginService({
  userDataPath,
  secretCodec,
  isPluginEnabled,
  readHistoryAttachment,
  createTransport = createDefaultTransport
}: GmailSmtpPluginServiceOptions): GmailSmtpPluginService {
  const settingsPath = join(userDataPath, "plugin-settings", settingsFileName);
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(mutation, mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function readSettings(): Promise<PersistedSmtpSettings | null> {
    try {
      const raw = await readFile(settingsPath, "utf8");
      return normalizePersistedSettings(JSON.parse(raw));
    } catch (caught) {
      const isMissing = caught instanceof Error && "code" in caught && caught.code === "ENOENT";
      const isCorrupt = caught instanceof SyntaxError;
      if (isMissing || isCorrupt) {
        return null;
      }
      throw caught;
    }
  }

  async function writeSettings(settings: PersistedSmtpSettings): Promise<void> {
    const tempPath = `${settingsPath}.tmp`;
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    await rename(tempPath, settingsPath);
  }

  async function loadCredentials(): Promise<PersistedSmtpSettings & { appPassword: string }> {
    const settings = await readSettings();
    if (!settings?.senderEmail || !settings.encryptedAppPassword) {
      throw new Error("SMTP settings are incomplete. Save the Gmail account and app password first.");
    }

    try {
      const appPassword = secretCodec.decryptString(Buffer.from(settings.encryptedAppPassword, "base64"));
      return {
        ...settings,
        appPassword
      };
    } catch {
      throw new Error("SMTP app password is unavailable. Save settings again.");
    }
  }

  async function createTransportContext(): Promise<SmtpTransportContext> {
    const settings = await loadCredentials();
    return {
      senderEmail: settings.senderEmail,
      transport: createTransport({
        host: settings.host,
        port: settings.port,
        secure: false,
        requireTLS: true,
        auth: {
          user: settings.senderEmail,
          pass: settings.appPassword
        }
      })
    };
  }

  async function createConfiguredTransport(): Promise<SmtpTransport> {
    return (await createTransportContext()).transport;
  }

  async function sendSecureHtmlEmail(request: PreparedSmtpEmailRequest): Promise<SendSmtpEmailResult> {
    try {
      const { senderEmail, transport } = await createTransportContext();
      const sent = await transport.sendMail({
        from: senderEmail,
        to: request.recipientEmail,
        subject: request.subject,
        text: "보안 HTML 문서를 첨부했습니다. 문서 열람 PIN은 별도 채널로 전달됩니다.",
        attachments: [
          {
            filename: request.attachmentFileName,
            content: request.attachmentHtml,
            contentType: "text/html; charset=utf-8"
          }
        ]
      });
      return {
        sent: true,
        messageId: sent.messageId
      };
    } catch (caught) {
      throw new Error(toSafeSmtpError(caught));
    }
  }

  async function sendVerifiedHistoryEmail(request: SendSmtpEmailRequest): Promise<SendSmtpEmailResult> {
    if (!readHistoryAttachment) {
      throw new Error("Publish history email delivery is not available.");
    }

    const attachmentHtml = await readHistoryAttachment(request);
    return sendSecureHtmlEmail({
      recipientEmail: request.recipientEmail,
      subject: request.subject,
      attachmentFileName: request.attachmentFileName,
      attachmentHtml
    });
  }

  async function assertEnabled(): Promise<void> {
    if (!(await isPluginEnabled(GMAIL_SMTP_PLUGIN_ID))) {
      throw new Error("SMTP plugin is disabled.");
    }
  }

  return {
    async getSettings(pluginId) {
      assertKnownPlugin(pluginId);
      return toSettingsView(await readSettings());
    },

    async saveSettings(pluginId, values) {
      assertKnownPlugin(pluginId);
      return enqueueMutation(async () => {
        const request = normalizeSaveRequest(values);
        const current = await readSettings();
        const hasNewPassword = typeof request.appPassword === "string" && request.appPassword.trim().length > 0;
        let encryptedAppPassword = current?.encryptedAppPassword;

        if (hasNewPassword) {
          if (!secretCodec.isEncryptionAvailable()) {
            throw new Error("Secure credential storage is not available on this device.");
          }
          const appPassword = validateSmtpAppPassword(request.appPassword ?? "");
          encryptedAppPassword = secretCodec.encryptString(appPassword).toString("base64");
        }

        const nextSettings: PersistedSmtpSettings = {
          host: request.host,
          port: request.port,
          senderEmail: request.senderEmail,
          encryptedAppPassword
        };
        await writeSettings(nextSettings);
        return toSettingsView(nextSettings);
      });
    },

    async clearSettings(pluginId) {
      assertKnownPlugin(pluginId);
      return enqueueMutation(async () => {
        await rm(settingsPath, { force: true });
        return emptySettingsView;
      });
    },

    async runAction(pluginId, actionId, payload) {
      assertKnownPlugin(pluginId);
      await assertEnabled();

      if (actionId === GMAIL_SMTP_TEST_ACTION_ID) {
        try {
          await (await createConfiguredTransport()).verify();
          const result: SmtpConnectionTestResult = { ok: true };
          return result;
        } catch (caught) {
          throw new Error(toSafeSmtpError(caught));
        }
      }

      if (actionId === GMAIL_SMTP_SEND_ACTION_ID) {
        const request = normalizeSendRequest(payload);
        return sendVerifiedHistoryEmail(request);
      }

      if (actionId === GMAIL_SMTP_HISTORY_SEND_ACTION_ID) {
        const historyRequest = normalizeHistorySendRequest(payload);
        return sendVerifiedHistoryEmail(historyRequest);
      }

      throw new Error(`Unknown plugin action: ${actionId}`);
    }
  };
}
