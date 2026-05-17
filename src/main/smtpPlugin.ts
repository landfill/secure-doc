import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import nodemailer from "nodemailer";
import type {
  PluginActionResult,
  SaveSmtpSettingsRequest,
  SendSmtpEmailRequest,
  SendSmtpEmailResult,
  SendSmtpHistoryEmailRequest,
  SmtpConnectionTestResult,
  SmtpSettingsView
} from "../shared/desktopApi.ts";
import {
  GENERIC_SMTP_HISTORY_SEND_ACTION_ID,
  GENERIC_SMTP_PLUGIN_ID,
  GENERIC_SMTP_SEND_ACTION_ID,
  GENERIC_SMTP_TEST_ACTION_ID,
  GMAIL_SMTP_HISTORY_SEND_ACTION_ID,
  GMAIL_SMTP_PLUGIN_ID,
  GMAIL_SMTP_SEND_ACTION_ID,
  GMAIL_SMTP_TEST_ACTION_ID,
  isSmtpDeliveryPluginId,
  type SmtpDeliveryPluginId
} from "../shared/plugins.ts";
import { normalizeDeliveryPackagePayload } from "./deliveryPlugin.ts";

interface PersistedSmtpSettings {
  host: string;
  port: number;
  senderEmail: string;
  username: string;
  secure: boolean;
  requireTLS: boolean;
  encryptedPassword?: string;
}

interface NormalizedSaveSmtpSettingsRequest {
  host: string;
  port: number;
  senderEmail: string;
  username: string;
  secure: boolean;
  requireTLS: boolean;
  password?: string;
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

interface SmtpPluginDefinition {
  id: SmtpDeliveryPluginId;
  defaultHost: string;
  defaultPort: number;
  defaultSecure: boolean;
  defaultRequireTLS: boolean;
  incompleteSettingsMessage: string;
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

export interface SmtpPluginServiceOptions {
  userDataPath: string;
  secretCodec: SmtpSecretCodec;
  isPluginEnabled(pluginId: string): Promise<boolean>;
  readHistoryAttachment?: (request: SendSmtpHistoryEmailRequest) => Promise<string>;
  createTransport?: (options: SmtpTransportOptions) => SmtpTransport;
}

export type GmailSmtpPluginServiceOptions = SmtpPluginServiceOptions;

export interface SmtpPluginService {
  getSettings(pluginId: string): Promise<SmtpSettingsView>;
  saveSettings(pluginId: string, values: unknown): Promise<SmtpSettingsView>;
  clearSettings(pluginId: string): Promise<SmtpSettingsView>;
  runAction(pluginId: string, actionId: string, payload?: unknown): Promise<PluginActionResult>;
}

export type GmailSmtpPluginService = SmtpPluginService;

const secureHtmlEmailBody = "A secure HTML document is attached. Share the PIN through a separate channel.";

const smtpPluginDefinitions: Record<SmtpDeliveryPluginId, SmtpPluginDefinition> = {
  [GMAIL_SMTP_PLUGIN_ID]: {
    id: GMAIL_SMTP_PLUGIN_ID,
    defaultHost: "smtp.gmail.com",
    defaultPort: 587,
    defaultSecure: false,
    defaultRequireTLS: true,
    incompleteSettingsMessage: "SMTP settings are incomplete. Save the Gmail account and app password first."
  },
  [GENERIC_SMTP_PLUGIN_ID]: {
    id: GENERIC_SMTP_PLUGIN_ID,
    defaultHost: "",
    defaultPort: 587,
    defaultSecure: false,
    defaultRequireTLS: true,
    incompleteSettingsMessage: "SMTP settings are incomplete. Save the SMTP account and password first."
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function definitionFor(pluginId: string): SmtpPluginDefinition {
  if (!isSmtpDeliveryPluginId(pluginId)) {
    throw new Error(`Unknown plugin: ${pluginId}`);
  }
  return smtpPluginDefinitions[pluginId];
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

export function normalizeSmtpPort(value: unknown, pluginId: SmtpDeliveryPluginId = GMAIL_SMTP_PLUGIN_ID): number {
  const port = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP port must be between 1 and 65535.");
  }
  if (pluginId === GMAIL_SMTP_PLUGIN_ID && port !== 587) {
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

function normalizeSmtpUsername(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("SMTP username is required.");
  }

  const username = value.normalize("NFKC").trim();
  if (!username || username.length > 254 || /[\u0000-\u001f\u007f]/.test(username)) {
    throw new Error("SMTP username is required.");
  }

  return username;
}

function normalizeBoolean(value: unknown, fallback: boolean, fieldLabel: string): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${fieldLabel} must be true or false.`);
  }
  return value;
}

export function validateSmtpAppPassword(value: string): string {
  const appPassword = normalizeSmtpAppPassword(value);
  if (appPassword.length !== 16) {
    throw new Error("Gmail app password must be 16 characters after removing spaces.");
  }
  return appPassword;
}

function validateGenericSmtpPassword(value: string): string {
  if (!value.trim() || value.length > 1024) {
    throw new Error("SMTP password is required.");
  }
  return value;
}

export function toSafeSmtpError(caught: unknown): string {
  const code = isRecord(caught) && typeof caught.code === "string" ? caught.code : "";
  const responseCode = isRecord(caught) && typeof caught.responseCode === "number" ? caught.responseCode : 0;

  if (responseCode === 534 || responseCode === 535 || code === "EAUTH") {
    return "SMTP authentication failed. Check the SMTP account and password.";
  }

  if (["ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ESOCKET"].includes(code)) {
    return "SMTP network connection failed. Check the host, port, and network connection.";
  }

  return "SMTP request failed. Check the SMTP settings and try again.";
}

function settingsPathFor(userDataPath: string, pluginId: SmtpDeliveryPluginId): string {
  return join(userDataPath, "plugin-settings", `${pluginId}.json`);
}

function emptySettingsView(pluginId: SmtpDeliveryPluginId): SmtpSettingsView {
  const definition = smtpPluginDefinitions[pluginId];
  return {
    pluginId,
    host: definition.defaultHost,
    port: definition.defaultPort,
    senderEmail: "",
    username: "",
    secure: definition.defaultSecure,
    requireTLS: definition.defaultRequireTLS,
    hasPassword: false,
    hasAppPassword: false
  };
}

function normalizePersistedSettings(pluginId: SmtpDeliveryPluginId, value: unknown): PersistedSmtpSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  try {
    const encryptedPassword =
      typeof value.encryptedPassword === "string" && value.encryptedPassword.trim()
        ? value.encryptedPassword
        : typeof value.encryptedAppPassword === "string" && value.encryptedAppPassword.trim()
          ? value.encryptedAppPassword
          : undefined;
    const senderEmail = normalizeSmtpEmail(value.senderEmail, "Sender email");
    const secure = pluginId === GMAIL_SMTP_PLUGIN_ID ? false : normalizeBoolean(value.secure, false, "SMTP secure mode");
    return {
      host: normalizeSmtpHost(value.host),
      port: normalizeSmtpPort(value.port, pluginId),
      senderEmail,
      username: pluginId === GMAIL_SMTP_PLUGIN_ID ? senderEmail : normalizeSmtpUsername(value.username ?? senderEmail),
      secure,
      requireTLS: pluginId === GMAIL_SMTP_PLUGIN_ID ? true : normalizeBoolean(value.requireTLS, !secure, "SMTP STARTTLS mode"),
      encryptedPassword
    };
  } catch {
    return null;
  }
}

function toSettingsView(pluginId: SmtpDeliveryPluginId, settings: PersistedSmtpSettings | null): SmtpSettingsView {
  if (!settings) {
    return emptySettingsView(pluginId);
  }

  const hasPassword = Boolean(settings.encryptedPassword);
  return {
    pluginId,
    host: settings.host,
    port: settings.port,
    senderEmail: settings.senderEmail,
    username: settings.username,
    secure: settings.secure,
    requireTLS: settings.requireTLS,
    hasPassword,
    hasAppPassword: hasPassword
  };
}

function normalizeSaveRequest(pluginId: SmtpDeliveryPluginId, values: unknown): NormalizedSaveSmtpSettingsRequest {
  if (!isRecord(values)) {
    throw new Error("SMTP settings are required.");
  }

  const senderEmail = normalizeSmtpEmail(values.senderEmail, "Sender email");
  const secure = pluginId === GMAIL_SMTP_PLUGIN_ID ? false : normalizeBoolean(values.secure, false, "SMTP secure mode");
  const secretValue =
    typeof values.password === "string"
      ? values.password
      : typeof values.appPassword === "string"
        ? values.appPassword
        : undefined;

  let password: string | undefined;
  if (typeof secretValue === "string" && secretValue.trim().length > 0) {
    password = pluginId === GMAIL_SMTP_PLUGIN_ID ? validateSmtpAppPassword(secretValue) : validateGenericSmtpPassword(secretValue);
  }

  return {
    host: normalizeSmtpHost(values.host),
    port: normalizeSmtpPort(values.port, pluginId),
    senderEmail,
    username: pluginId === GMAIL_SMTP_PLUGIN_ID ? senderEmail : normalizeSmtpUsername(values.username ?? senderEmail),
    secure,
    requireTLS: pluginId === GMAIL_SMTP_PLUGIN_ID ? true : normalizeBoolean(values.requireTLS, !secure, "SMTP STARTTLS mode"),
    password
  };
}

function normalizeSendRequest(payload: unknown): SendSmtpEmailRequest {
  const deliveryPayload = normalizeDeliveryPackagePayload(payload);
  if (!isRecord(payload)) {
    throw new Error("Email send request is required.");
  }

  const subject = typeof payload.subject === "string" ? payload.subject.normalize("NFKC").trim() : "";
  if (!subject) {
    throw new Error("Email subject is required.");
  }

  return {
    ...deliveryPayload,
    recipientEmail: normalizeSmtpEmail(payload.recipientEmail, "Recipient email"),
    subject
  };
}

function normalizeHistorySendRequest(payload: unknown): SendSmtpHistoryEmailRequest {
  return normalizeSendRequest(payload);
}

function createDefaultTransport(options: SmtpTransportOptions): SmtpTransport {
  return nodemailer.createTransport(options) as SmtpTransport;
}

export function createSmtpDeliveryPluginService({
  userDataPath,
  secretCodec,
  isPluginEnabled,
  readHistoryAttachment,
  createTransport = createDefaultTransport
}: SmtpPluginServiceOptions): SmtpPluginService {
  let mutationQueue: Promise<unknown> = Promise.resolve();

  function enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(mutation, mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function readSettings(pluginId: SmtpDeliveryPluginId): Promise<PersistedSmtpSettings | null> {
    try {
      const raw = await readFile(settingsPathFor(userDataPath, pluginId), "utf8");
      return normalizePersistedSettings(pluginId, JSON.parse(raw));
    } catch (caught) {
      const isMissing = caught instanceof Error && "code" in caught && caught.code === "ENOENT";
      const isCorrupt = caught instanceof SyntaxError;
      if (isMissing || isCorrupt) {
        return null;
      }
      throw caught;
    }
  }

  async function writeSettings(pluginId: SmtpDeliveryPluginId, settings: PersistedSmtpSettings): Promise<void> {
    const settingsPath = settingsPathFor(userDataPath, pluginId);
    const tempPath = `${settingsPath}.tmp`;
    const persistedSettings = {
      host: settings.host,
      port: settings.port,
      senderEmail: settings.senderEmail,
      username: settings.username,
      secure: settings.secure,
      requireTLS: settings.requireTLS,
      encryptedPassword: settings.encryptedPassword
    };
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(persistedSettings, null, 2)}\n`, "utf8");
    await rename(tempPath, settingsPath);
  }

  async function loadCredentials(pluginId: SmtpDeliveryPluginId): Promise<PersistedSmtpSettings & { password: string }> {
    const definition = smtpPluginDefinitions[pluginId];
    const settings = await readSettings(pluginId);
    if (!settings?.senderEmail || !settings.username || !settings.encryptedPassword) {
      throw new Error(definition.incompleteSettingsMessage);
    }

    try {
      const password = secretCodec.decryptString(Buffer.from(settings.encryptedPassword, "base64"));
      return {
        ...settings,
        password
      };
    } catch {
      throw new Error("SMTP password is unavailable. Save settings again.");
    }
  }

  async function createTransportContext(pluginId: SmtpDeliveryPluginId): Promise<SmtpTransportContext> {
    const settings = await loadCredentials(pluginId);
    return {
      senderEmail: settings.senderEmail,
      transport: createTransport({
        host: settings.host,
        port: settings.port,
        secure: settings.secure,
        requireTLS: settings.requireTLS,
        auth: {
          user: settings.username,
          pass: settings.password
        }
      })
    };
  }

  async function createConfiguredTransport(pluginId: SmtpDeliveryPluginId): Promise<SmtpTransport> {
    return (await createTransportContext(pluginId)).transport;
  }

  async function sendSecureHtmlEmail(
    pluginId: SmtpDeliveryPluginId,
    request: PreparedSmtpEmailRequest
  ): Promise<SendSmtpEmailResult> {
    try {
      const { senderEmail, transport } = await createTransportContext(pluginId);
      const sent = await transport.sendMail({
        from: senderEmail,
        to: request.recipientEmail,
        subject: request.subject,
        text: secureHtmlEmailBody,
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

  async function sendVerifiedHistoryEmail(
    pluginId: SmtpDeliveryPluginId,
    request: SendSmtpEmailRequest
  ): Promise<SendSmtpEmailResult> {
    if (!readHistoryAttachment) {
      throw new Error("Publish history email delivery is not available.");
    }

    const attachmentHtml = await readHistoryAttachment(request);
    return sendSecureHtmlEmail(pluginId, {
      recipientEmail: request.recipientEmail,
      subject: request.subject,
      attachmentFileName: request.attachmentFileName,
      attachmentHtml
    });
  }

  async function assertEnabled(pluginId: SmtpDeliveryPluginId): Promise<void> {
    if (!(await isPluginEnabled(pluginId))) {
      throw new Error("SMTP plugin is disabled.");
    }
  }

  return {
    async getSettings(pluginId) {
      const definition = definitionFor(pluginId);
      return toSettingsView(definition.id, await readSettings(definition.id));
    },

    async saveSettings(pluginId, values) {
      const definition = definitionFor(pluginId);
      return enqueueMutation(async () => {
        const request = normalizeSaveRequest(definition.id, values);
        const current = await readSettings(definition.id);
        let encryptedPassword = current?.encryptedPassword;

        if (typeof request.password === "string") {
          if (!secretCodec.isEncryptionAvailable()) {
            throw new Error("Secure credential storage is not available on this device.");
          }
          encryptedPassword = secretCodec.encryptString(request.password).toString("base64");
        }

        const nextSettings: PersistedSmtpSettings = {
          host: request.host,
          port: request.port,
          senderEmail: request.senderEmail,
          username: request.username,
          secure: request.secure,
          requireTLS: request.requireTLS,
          encryptedPassword
        };
        await writeSettings(definition.id, nextSettings);
        return toSettingsView(definition.id, nextSettings);
      });
    },

    async clearSettings(pluginId) {
      const definition = definitionFor(pluginId);
      return enqueueMutation(async () => {
        await rm(settingsPathFor(userDataPath, definition.id), { force: true });
        return emptySettingsView(definition.id);
      });
    },

    async runAction(pluginId, actionId, payload) {
      const definition = definitionFor(pluginId);
      await assertEnabled(definition.id);

      if (actionId === GMAIL_SMTP_TEST_ACTION_ID || actionId === GENERIC_SMTP_TEST_ACTION_ID) {
        try {
          await (await createConfiguredTransport(definition.id)).verify();
          const result: SmtpConnectionTestResult = { ok: true };
          return result;
        } catch (caught) {
          throw new Error(toSafeSmtpError(caught));
        }
      }

      if (actionId === GMAIL_SMTP_SEND_ACTION_ID || actionId === GENERIC_SMTP_SEND_ACTION_ID) {
        const request = normalizeSendRequest(payload);
        return sendVerifiedHistoryEmail(definition.id, request);
      }

      if (actionId === GMAIL_SMTP_HISTORY_SEND_ACTION_ID || actionId === GENERIC_SMTP_HISTORY_SEND_ACTION_ID) {
        const historyRequest = normalizeHistorySendRequest(payload);
        return sendVerifiedHistoryEmail(definition.id, historyRequest);
      }

      throw new Error(`Unknown plugin action: ${actionId}`);
    }
  };
}

export function createGmailSmtpPluginService(options: GmailSmtpPluginServiceOptions): GmailSmtpPluginService {
  return createSmtpDeliveryPluginService(options);
}
