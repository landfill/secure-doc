import { assertValidPin, DEFAULT_PIN_KDF_ITERATIONS, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "./pinPolicy.ts";
import { base64UrlToBytes, bytesEqual, bytesToBase64Url, utf8Decode, utf8Encode } from "./encoding.ts";
import type { SecureDocViewerTheme } from "./branding.ts";

export const PACKAGE_SCHEMA = "com.company.secure-html-doc";
export const PACKAGE_VERSION = "1.0.0";
export const PUBLIC_UNLOCK_ERROR = "PIN이 올바르지 않거나 문서가 손상되었습니다.";

export interface SecureDocPlainContent {
  type: "secure-doc-content";
  version: "1.0";
  format: "html";
  html: string;
  assets: Array<never>;
  privateMeta?: {
    description?: string;
    docType?: string;
    watermarkText?: string;
    recipientName?: string;
    documentNumber?: string;
    branding?: {
      pluginId: string;
      presetId: string;
      label: string;
      viewerTheme?: SecureDocViewerTheme;
    };
  };
}

export interface SecureDocMetadataInput {
  id?: string;
  title: string;
  issuer: string;
  issuedAt?: string;
  displayExpiresAt?: string;
}

export interface SecureDocPackage {
  schema: typeof PACKAGE_SCHEMA;
  version: typeof PACKAGE_VERSION;
  doc: {
    id: string;
    title: string;
    issuer: string;
    issuedAt: string;
    displayExpiresAt?: string;
    format: "html";
  };
  crypto: {
    kdf: {
      name: "PBKDF2";
      hash: "SHA-256";
      iterations: number;
      salt: string;
    };
    keyWrap: {
      alg: "AES-GCM";
      iv: string;
      ciphertext: string;
    };
    contentEncryption: {
      alg: "AES-GCM";
      iv: string;
      aad: string;
      ciphertext: string;
    };
  };
  ui: {
    keyLabel: "문서 열람 PIN";
    helpText: "별도 안내받은 6자리 이상 15자리 이내 PIN을 입력하세요.";
    keyPolicy: {
      type: "pin-code";
      minLength: number;
      maxLength: number;
      normalization: "nfkc-trim";
      allowedCharacters: "printable";
    };
    watermark: boolean;
  };
}

export interface IssueSecureDocumentOptions {
  content: SecureDocPlainContent;
  pin: string;
  metadata: SecureDocMetadataInput;
  iterations?: number;
}

export class SecureDocUnlockError extends Error {
  constructor() {
    super(PUBLIC_UNLOCK_ERROR);
    this.name = "SecureDocUnlockError";
  }
}

function getCrypto(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("WebCrypto is required to issue or unlock secure documents.");
  }
  return globalThis.crypto;
}

function randomBytes(length: number, crypto = getCrypto()): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function canonicalAadJson(doc: SecureDocPackage["doc"]): string {
  return JSON.stringify({
    schema: PACKAGE_SCHEMA,
    version: PACKAGE_VERSION,
    docId: doc.id,
    title: doc.title,
    issuer: doc.issuer,
    issuedAt: doc.issuedAt,
    displayExpiresAt: doc.displayExpiresAt ?? null,
    contentType: "application/json; format=secure-doc-content"
  });
}

function buildAadBytes(doc: SecureDocPackage["doc"]): Uint8Array {
  return utf8Encode(canonicalAadJson(doc));
}

export function generateDocumentId(date = new Date(), crypto = getCrypto()): string {
  const yyyymmdd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const suffix = bytesToBase64Url(randomBytes(8, crypto)).slice(0, 11);
  return `doc_${yyyymmdd}_${suffix}`;
}

async function deriveKek(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const crypto = getCrypto();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    toBufferSource(utf8Encode(pin)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toBufferSource(salt),
      iterations
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function issueSecureDocument(options: IssueSecureDocumentOptions): Promise<SecureDocPackage> {
  const crypto = getCrypto();
  const pin = assertValidPin(options.pin);
  const iterations = options.iterations ?? DEFAULT_PIN_KDF_ITERATIONS;
  const issuedAt = options.metadata.issuedAt ?? new Date().toISOString();

  const doc: SecureDocPackage["doc"] = {
    id: options.metadata.id ?? generateDocumentId(new Date(issuedAt), crypto),
    title: options.metadata.title,
    issuer: options.metadata.issuer,
    issuedAt,
    displayExpiresAt: options.metadata.displayExpiresAt || undefined,
    format: "html"
  };

  const contentBytes = utf8Encode(JSON.stringify(options.content));
  const dek = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );

  const contentIv = randomBytes(12, crypto);
  const aadBytes = buildAadBytes(doc);
  const encryptedContent = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(contentIv),
      additionalData: toBufferSource(aadBytes),
      tagLength: 128
    },
    dek,
    toBufferSource(contentBytes)
  );

  const salt = randomBytes(32, crypto);
  const kek = await deriveKek(pin, salt, iterations);
  const rawDek = await crypto.subtle.exportKey("raw", dek);
  const wrapIv = randomBytes(12, crypto);
  const wrappedDek = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toBufferSource(wrapIv),
      tagLength: 128
    },
    kek,
    rawDek
  );

  const securePackage: SecureDocPackage = {
    schema: PACKAGE_SCHEMA,
    version: PACKAGE_VERSION,
    doc,
    crypto: {
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations,
        salt: bytesToBase64Url(salt)
      },
      keyWrap: {
        alg: "AES-GCM",
        iv: bytesToBase64Url(wrapIv),
        ciphertext: bytesToBase64Url(wrappedDek)
      },
      contentEncryption: {
        alg: "AES-GCM",
        iv: bytesToBase64Url(contentIv),
        aad: bytesToBase64Url(aadBytes),
        ciphertext: bytesToBase64Url(encryptedContent)
      }
    },
    ui: {
      keyLabel: "문서 열람 PIN",
      helpText: "별도 안내받은 6자리 이상 15자리 이내 PIN을 입력하세요.",
      keyPolicy: {
        type: "pin-code",
        minLength: PIN_MIN_LENGTH,
        maxLength: PIN_MAX_LENGTH,
        normalization: "nfkc-trim",
        allowedCharacters: "printable"
      },
      watermark: Boolean(options.content.privateMeta?.watermarkText)
    }
  };

  const verifiedContent = await unlockSecureDocument(pin, securePackage);
  if (JSON.stringify(verifiedContent) !== JSON.stringify(options.content)) {
    throw new Error("Issued package failed the pre-publish decrypt verification.");
  }

  return securePackage;
}

export async function unlockSecureDocument(pinInput: string, securePackage: SecureDocPackage): Promise<SecureDocPlainContent> {
  try {
    const crypto = getCrypto();
    const pin = assertValidPin(pinInput, {
      minLength: securePackage.ui.keyPolicy.minLength,
      maxLength: securePackage.ui.keyPolicy.maxLength
    });
    const aadBytes = buildAadBytes(securePackage.doc);
    const storedAad = base64UrlToBytes(securePackage.crypto.contentEncryption.aad);

    if (!bytesEqual(aadBytes, storedAad)) {
      throw new Error("AAD mismatch.");
    }

    const kek = await deriveKek(
      pin,
      base64UrlToBytes(securePackage.crypto.kdf.salt),
      securePackage.crypto.kdf.iterations
    );

    const rawDek = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toBufferSource(base64UrlToBytes(securePackage.crypto.keyWrap.iv)),
        tagLength: 128
      },
      kek,
      toBufferSource(base64UrlToBytes(securePackage.crypto.keyWrap.ciphertext))
    );

    const dek = await crypto.subtle.importKey(
      "raw",
      rawDek,
      {
        name: "AES-GCM"
      },
      false,
      ["decrypt"]
    );

    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toBufferSource(base64UrlToBytes(securePackage.crypto.contentEncryption.iv)),
        additionalData: toBufferSource(aadBytes),
        tagLength: 128
      },
      dek,
      toBufferSource(base64UrlToBytes(securePackage.crypto.contentEncryption.ciphertext))
    );

    return JSON.parse(utf8Decode(plaintext)) as SecureDocPlainContent;
  } catch {
    throw new SecureDocUnlockError();
  }
}
