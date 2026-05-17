import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createGmailSmtpPluginService,
  normalizeSmtpAppPassword,
  type SmtpSecretCodec,
  type SmtpTransport
} from "../src/main/smtpPlugin.ts";
import {
  GMAIL_SMTP_HISTORY_SEND_ACTION_ID,
  GMAIL_SMTP_PLUGIN_ID,
  GMAIL_SMTP_SEND_ACTION_ID,
  GMAIL_SMTP_TEST_ACTION_ID
} from "../src/shared/plugins.ts";

const fakeSecretCodec: SmtpSecretCodec = {
  isEncryptionAvailable() {
    return true;
  },
  encryptString(value: string) {
    return Buffer.from(`cipher:${value}`, "utf8");
  },
  decryptString(value: Buffer) {
    const raw = value.toString("utf8");
    if (!raw.startsWith("cipher:")) {
      throw new Error("Invalid cipher text.");
    }
    return raw.slice("cipher:".length);
  }
};

async function withTempUserData(run: (userDataPath: string) => Promise<void>): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), "secure-doc-smtp-plugin-"));
  try {
    await run(userDataPath);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
}

test("normalizes Gmail app passwords copied with spaces", () => {
  assert.equal(normalizeSmtpAppPassword("abcd efgh ijkl mnop"), "abcdefghijklmnop");
  assert.equal(normalizeSmtpAppPassword("１２３４ ５６７８ ９０１２ ３４５６"), "1234567890123456");
});

test("SMTP settings are validated and stored without exposing the raw app password", async () => {
  await withTempUserData(async (userDataPath) => {
    const service = createGmailSmtpPluginService({
      userDataPath,
      secretCodec: fakeSecretCodec,
      isPluginEnabled: async () => false
    });

    await assert.rejects(
      () =>
        service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
          host: "https://smtp.gmail.com",
          port: 587,
          senderEmail: "sender@gmail.com",
          appPassword: "abcd efgh ijkl mnop"
        }),
      /SMTP host/
    );
    await assert.rejects(
      () =>
        service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
          host: "smtp.gmail.com",
          port: 70000,
          senderEmail: "sender@gmail.com",
          appPassword: "abcd efgh ijkl mnop"
        }),
      /SMTP port/
    );
    await assert.rejects(
      () =>
        service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
          host: "smtp.gmail.com",
          port: 587,
          senderEmail: "sender",
          appPassword: "abcd efgh ijkl mnop"
        }),
      /Sender email/
    );
    await assert.rejects(
      () =>
        service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
          host: "smtp.gmail.com",
          port: 587,
          senderEmail: "sender@gmail.com",
          appPassword: "short"
        }),
      /16 characters/
    );

    const view = await service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
      host: "SMTP.GMAIL.COM",
      port: 587,
      senderEmail: "sender@gmail.com",
      appPassword: "abcd efgh ijkl mnop"
    });

    assert.deepEqual(view, {
      pluginId: GMAIL_SMTP_PLUGIN_ID,
      host: "smtp.gmail.com",
      port: 587,
      senderEmail: "sender@gmail.com",
      hasAppPassword: true
    });
    assert.equal("appPassword" in view, false);

    const raw = await readFile(join(userDataPath, "plugin-settings", `${GMAIL_SMTP_PLUGIN_ID}.json`), "utf8");
    assert.equal(raw.includes("abcdefghijklmnop"), false);
    assert.equal(raw.includes("abcd efgh ijkl mnop"), false);
    assert.equal(raw.includes("sender@gmail.com"), true);
  });
});

test("SMTP actions verify and send through the injected transport only when enabled", async () => {
  await withTempUserData(async (userDataPath) => {
    let enabled = false;
    let verifyCount = 0;
    const transportOptions: unknown[] = [];
    const sentMessages: unknown[] = [];
    const service = createGmailSmtpPluginService({
      userDataPath,
      secretCodec: fakeSecretCodec,
      isPluginEnabled: async () => enabled,
      createTransport(options): SmtpTransport {
        transportOptions.push(options);
        return {
          async verify() {
            verifyCount += 1;
          },
          async sendMail(message) {
            sentMessages.push(message);
            return { messageId: "message-1" };
          }
        };
      }
    });

    await service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
      host: "smtp.gmail.com",
      port: 587,
      senderEmail: "sender@gmail.com",
      appPassword: "abcd efgh ijkl mnop"
    });

    await assert.rejects(() => service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_TEST_ACTION_ID), /disabled/);

    enabled = true;
    assert.deepEqual(await service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_TEST_ACTION_ID), { ok: true });
    assert.equal(verifyCount, 1);

    const result = await service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_SEND_ACTION_ID, {
      recipientEmail: "recipient@example.com",
      subject: "Secure document",
      attachmentFileName: "secure.html",
      attachmentHtml: "<!doctype html><title>Encrypted package</title>"
    });

    assert.deepEqual(result, { sent: true, messageId: "message-1" });
    assert.equal(transportOptions.length, 2);
    assert.deepEqual(transportOptions[0], {
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: "sender@gmail.com",
        pass: "abcdefghijklmnop"
      }
    });
    assert.deepEqual(sentMessages[0], {
      from: "sender@gmail.com",
      to: "recipient@example.com",
      subject: "Secure document",
      text: "A secure HTML document is attached. The document PIN is delivered separately.",
      attachments: [
        {
          filename: "secure.html",
          content: "<!doctype html><title>Encrypted package</title>",
          contentType: "text/html; charset=utf-8"
        }
      ]
    });
  });
});

test("SMTP history action reads a validated history attachment before sending", async () => {
  await withTempUserData(async (userDataPath) => {
    const historyRequests: unknown[] = [];
    const sentMessages: unknown[] = [];
    const service = createGmailSmtpPluginService({
      userDataPath,
      secretCodec: fakeSecretCodec,
      isPluginEnabled: async () => true,
      async readHistoryAttachment(request) {
        historyRequests.push(request);
        assert.equal(request.documentId, "doc-1");
        assert.equal(request.outputPath, "C:\\secure\\doc-1.html");
        return "<!doctype html><title>Saved package</title>";
      },
      createTransport(): SmtpTransport {
        return {
          async verify() {},
          async sendMail(message) {
            sentMessages.push(message);
            return { messageId: "history-message-1" };
          }
        };
      }
    });

    await service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
      host: "smtp.gmail.com",
      port: 587,
      senderEmail: "sender@gmail.com",
      appPassword: "abcd efgh ijkl mnop"
    });

    const result = await service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_HISTORY_SEND_ACTION_ID, {
      documentId: "doc-1",
      outputPath: "C:\\secure\\doc-1.html",
      recipientEmail: "recipient@example.com",
      subject: "Saved secure document",
      attachmentFileName: "doc-1.html"
    });

    assert.deepEqual(result, { sent: true, messageId: "history-message-1" });
    assert.equal(historyRequests.length, 1);
    assert.deepEqual(sentMessages[0], {
      from: "sender@gmail.com",
      to: "recipient@example.com",
      subject: "Saved secure document",
      text: "A secure HTML document is attached. The document PIN is delivered separately.",
      attachments: [
        {
          filename: "doc-1.html",
          content: "<!doctype html><title>Saved package</title>",
          contentType: "text/html; charset=utf-8"
        }
      ]
    });
  });
});

test("SMTP action errors are mapped to safe messages without leaking secrets or document data", async () => {
  await withTempUserData(async (userDataPath) => {
    const service = createGmailSmtpPluginService({
      userDataPath,
      secretCodec: fakeSecretCodec,
      isPluginEnabled: async () => true,
      createTransport(): SmtpTransport {
        return {
          async verify() {
            const error = new Error(
              "Auth failed for sender@gmail.com using abcdefghijklmnop with PIN 123456 and Plain confidential body"
            );
            Object.assign(error, { code: "EAUTH", responseCode: 535 });
            throw error;
          },
          async sendMail() {
            throw new Error("unused");
          }
        };
      }
    });

    await service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
      host: "smtp.gmail.com",
      port: 587,
      senderEmail: "sender@gmail.com",
      appPassword: "abcd efgh ijkl mnop"
    });

    await assert.rejects(
      () => service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_TEST_ACTION_ID),
      (caught) => {
        assert.ok(caught instanceof Error);
        assert.match(caught.message, /authentication failed/);
        assert.equal(caught.message.includes("sender@gmail.com"), false);
        assert.equal(caught.message.includes("abcdefghijklmnop"), false);
        assert.equal(caught.message.includes("123456"), false);
        assert.equal(caught.message.includes("Plain confidential body"), false);
        return true;
      }
    );
  });
});
