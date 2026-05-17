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
  GENERIC_SMTP_HISTORY_SEND_ACTION_ID,
  GENERIC_SMTP_PLUGIN_ID,
  GENERIC_SMTP_SEND_ACTION_ID,
  GENERIC_SMTP_TEST_ACTION_ID,
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
      /SMTP 호스트/
    );
    await assert.rejects(
      () =>
        service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
          host: "smtp.gmail.com",
          port: 70000,
          senderEmail: "sender@gmail.com",
          appPassword: "abcd efgh ijkl mnop"
        }),
      /SMTP 포트/
    );
    await assert.rejects(
      () =>
        service.saveSettings(GMAIL_SMTP_PLUGIN_ID, {
          host: "smtp.gmail.com",
          port: 465,
          senderEmail: "sender@gmail.com",
          appPassword: "abcd efgh ijkl mnop"
        }),
      /587/
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
      /16자/
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
      username: "sender@gmail.com",
      secure: false,
      requireTLS: true,
      hasPassword: true,
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
    const historyRequests: unknown[] = [];
    const sentMessages: unknown[] = [];
    const service = createGmailSmtpPluginService({
      userDataPath,
      secretCodec: fakeSecretCodec,
      isPluginEnabled: async () => enabled,
      async readHistoryAttachment(request) {
        historyRequests.push(request);
        assert.equal(request.documentId, "doc-1");
        assert.equal(request.outputPath, "C:\\secure\\doc-1.html");
        return "<!doctype html><title>Encrypted package</title>";
      },
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

    await assert.rejects(() => service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_TEST_ACTION_ID), /비활성화/);

    enabled = true;
    assert.deepEqual(await service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_TEST_ACTION_ID), { ok: true });
    assert.equal(verifyCount, 1);

    const result = await service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_SEND_ACTION_ID, {
      documentId: "doc-1",
      outputPath: "C:\\secure\\doc-1.html",
      recipientEmail: "recipient@example.com",
      subject: "Secure document",
      attachmentFileName: "secure.html"
    });

    assert.deepEqual(result, { sent: true, messageId: "message-1" });
    assert.equal(transportOptions.length, 2);
    assert.equal(historyRequests.length, 1);
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
      text: "보안 HTML 문서를 첨부했습니다. 문서 열람 PIN은 별도 채널로 전달됩니다.",
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
      text: "보안 HTML 문서를 첨부했습니다. 문서 열람 PIN은 별도 채널로 전달됩니다.",
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

test("generic SMTP settings store encrypted credentials and send through configured transport", async () => {
  await withTempUserData(async (userDataPath) => {
    const transportOptions: unknown[] = [];
    const historyRequests: unknown[] = [];
    const sentMessages: unknown[] = [];
    const service = createGmailSmtpPluginService({
      userDataPath,
      secretCodec: fakeSecretCodec,
      isPluginEnabled: async (pluginId) => pluginId === GENERIC_SMTP_PLUGIN_ID,
      async readHistoryAttachment(request) {
        historyRequests.push(request);
        assert.equal(request.documentId, "doc-2");
        assert.equal(request.outputPath, "C:\\secure\\doc-2.html");
        return "<!doctype html><title>Generic SMTP package</title>";
      },
      createTransport(options): SmtpTransport {
        transportOptions.push(options);
        return {
          async verify() {},
          async sendMail(message) {
            sentMessages.push(message);
            return { messageId: "generic-message-1" };
          }
        };
      }
    });

    const view = await service.saveSettings(GENERIC_SMTP_PLUGIN_ID, {
      host: "MAIL.EXAMPLE.INTERNAL",
      port: 2525,
      senderEmail: "sender@example.com",
      username: "smtp-user",
      password: "smtp secret 123",
      secure: false,
      requireTLS: true
    });

    assert.deepEqual(view, {
      pluginId: GENERIC_SMTP_PLUGIN_ID,
      host: "mail.example.internal",
      port: 2525,
      senderEmail: "sender@example.com",
      username: "smtp-user",
      secure: false,
      requireTLS: true,
      hasPassword: true,
      hasAppPassword: true
    });

    const raw = await readFile(join(userDataPath, "plugin-settings", `${GENERIC_SMTP_PLUGIN_ID}.json`), "utf8");
    assert.equal(raw.includes("smtp secret 123"), false);
    assert.equal(raw.includes("smtp-user"), true);

    assert.deepEqual(await service.runAction(GENERIC_SMTP_PLUGIN_ID, GENERIC_SMTP_TEST_ACTION_ID), { ok: true });
    const result = await service.runAction(GENERIC_SMTP_PLUGIN_ID, GENERIC_SMTP_HISTORY_SEND_ACTION_ID, {
      documentId: "doc-2",
      outputPath: "C:\\secure\\doc-2.html",
      recipientEmail: "recipient@example.com",
      subject: "Generic SMTP document",
      attachmentFileName: "doc-2.html"
    });

    assert.deepEqual(result, { sent: true, messageId: "generic-message-1" });
    assert.equal(historyRequests.length, 1);
    assert.deepEqual(transportOptions[0], {
      host: "mail.example.internal",
      port: 2525,
      secure: false,
      requireTLS: true,
      allowInternalNetworkInterfaces: true,
      auth: {
        user: "smtp-user",
        pass: "smtp secret 123"
      }
    });
    assert.deepEqual(sentMessages[0], {
      from: "sender@example.com",
      to: "recipient@example.com",
      subject: "Generic SMTP document",
      text: "보안 HTML 문서를 첨부했습니다. 문서 열람 PIN은 별도 채널로 전달됩니다.",
      attachments: [
        {
          filename: "doc-2.html",
          content: "<!doctype html><title>Generic SMTP package</title>",
          contentType: "text/html; charset=utf-8"
        }
      ]
    });
  });
});

test("generic SMTP errors are masked without leaking credentials or package contents", async () => {
  await withTempUserData(async (userDataPath) => {
    const service = createGmailSmtpPluginService({
      userDataPath,
      secretCodec: fakeSecretCodec,
      isPluginEnabled: async (pluginId) => pluginId === GENERIC_SMTP_PLUGIN_ID,
      async readHistoryAttachment() {
        return "<!doctype html><body>Plain confidential body PIN 123456 DEK dek-secret KEK kek-secret</body>";
      },
      createTransport(): SmtpTransport {
        return {
          async verify() {},
          async sendMail() {
            const error = new Error(
              "SMTP failed for sender@example.com using smtp secret 123 with Plain confidential body PIN 123456 DEK dek-secret KEK kek-secret"
            );
            Object.assign(error, { code: "EAUTH", responseCode: 535 });
            throw error;
          }
        };
      }
    });

    await service.saveSettings(GENERIC_SMTP_PLUGIN_ID, {
      host: "mail.example.internal",
      port: 587,
      senderEmail: "sender@example.com",
      username: "smtp-user",
      password: "smtp secret 123",
      secure: false,
      requireTLS: true
    });

    await assert.rejects(
      () =>
        service.runAction(GENERIC_SMTP_PLUGIN_ID, GENERIC_SMTP_SEND_ACTION_ID, {
          documentId: "doc-2",
          outputPath: "C:\\secure\\doc-2.html",
          recipientEmail: "recipient@example.com",
          subject: "Generic SMTP document",
          attachmentFileName: "doc-2.html"
        }),
      (caught) => {
        assert.ok(caught instanceof Error);
        assert.match(caught.message, /SMTP 인증/);
        assert.equal(caught.message.includes("sender@example.com"), false);
        assert.equal(caught.message.includes("smtp secret 123"), false);
        assert.equal(caught.message.includes("123456"), false);
        assert.equal(caught.message.includes("dek-secret"), false);
        assert.equal(caught.message.includes("kek-secret"), false);
        assert.equal(caught.message.includes("Plain confidential body"), false);
        return true;
      }
    );
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
              "Auth failed for sender@gmail.com using abcdefghijklmnop with PIN 123456 PIN hash pinhash-abc DEK dek-secret KEK kek-secret and Plain confidential body"
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
        assert.match(caught.message, /SMTP 인증/);
        assert.equal(caught.message.includes("sender@gmail.com"), false);
        assert.equal(caught.message.includes("abcdefghijklmnop"), false);
        assert.equal(caught.message.includes("123456"), false);
        assert.equal(caught.message.includes("pinhash-abc"), false);
        assert.equal(caught.message.includes("dek-secret"), false);
        assert.equal(caught.message.includes("kek-secret"), false);
        assert.equal(caught.message.includes("Plain confidential body"), false);
        return true;
      }
    );
  });
});

test("SMTP send failures are mapped to safe messages without leaking attachment contents", async () => {
  await withTempUserData(async (userDataPath) => {
    const service = createGmailSmtpPluginService({
      userDataPath,
      secretCodec: fakeSecretCodec,
      isPluginEnabled: async () => true,
      async readHistoryAttachment() {
        return "<!doctype html><body>Plain confidential body PIN 123456 PIN hash pinhash-abc DEK dek-secret KEK kek-secret</body>";
      },
      createTransport(): SmtpTransport {
        return {
          async verify() {},
          async sendMail() {
            throw new Error(
              "SMTP failed for sender@gmail.com using abcdefghijklmnop with Plain confidential body PIN 123456 PIN hash pinhash-abc DEK dek-secret KEK kek-secret"
            );
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
      () =>
        service.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_SEND_ACTION_ID, {
          documentId: "doc-1",
          outputPath: "C:\\secure\\doc-1.html",
          recipientEmail: "recipient@example.com",
          subject: "Secure document",
          attachmentFileName: "secure.html"
        }),
      (caught) => {
        assert.ok(caught instanceof Error);
        assert.match(caught.message, /SMTP 요청/);
        assert.equal(caught.message.includes("sender@gmail.com"), false);
        assert.equal(caught.message.includes("abcdefghijklmnop"), false);
        assert.equal(caught.message.includes("123456"), false);
        assert.equal(caught.message.includes("pinhash-abc"), false);
        assert.equal(caught.message.includes("dek-secret"), false);
        assert.equal(caught.message.includes("kek-secret"), false);
        assert.equal(caught.message.includes("Plain confidential body"), false);
        return true;
      }
    );
  });
});
