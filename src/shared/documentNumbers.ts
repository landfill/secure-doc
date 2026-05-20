const DOCUMENT_NUMBER_SUFFIX_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_DOCUMENT_NUMBER_PREFIX = "DOC";
const DEFAULT_DOCUMENT_NUMBER_SUFFIX_LENGTH = 4;

const documentTypePrefixes: Record<string, string> = {
  "안내문": "NTC",
  "계약서": "CTR",
  "정책/규정": "POL",
  "기타": "DOC",
  "보험증서": "INS",
  "고지서": "BIL"
};

let fallbackEntropyCounter = 0;

export type DocumentNumberRandomBytes = (length: number) => Uint8Array;

export type GeneratePresetDocumentNumberOptions = {
  date?: Date;
  docType?: string;
  prefix?: string;
  randomBytes?: DocumentNumberRandomBytes;
  suffixLength?: number;
};

function normalizePrefix(prefix: string | undefined): string {
  const normalized = (prefix ?? DEFAULT_DOCUMENT_NUMBER_PREFIX).normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || DEFAULT_DOCUMENT_NUMBER_PREFIX;
}

function formatDocumentNumberDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function fallbackRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const seed = `${Date.now().toString(36)}${(fallbackEntropyCounter += 1).toString(36)}`;

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (seed.charCodeAt(index % seed.length) + index * 17) % 256;
  }

  return bytes;
}

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }

  return fallbackRandomBytes(length);
}

export function documentNumberPrefixForType(docType: string | undefined): string {
  return documentTypePrefixes[docType ?? ""] ?? DEFAULT_DOCUMENT_NUMBER_PREFIX;
}

export function generatePresetDocumentNumber(options: GeneratePresetDocumentNumberOptions = {}): string {
  const suffixLength = Math.max(1, options.suffixLength ?? DEFAULT_DOCUMENT_NUMBER_SUFFIX_LENGTH);
  const randomBytes = options.randomBytes ?? defaultRandomBytes;
  const bytes = randomBytes(suffixLength);
  const suffix = Array.from(bytes, (byte) => DOCUMENT_NUMBER_SUFFIX_ALPHABET[byte % DOCUMENT_NUMBER_SUFFIX_ALPHABET.length]).join("");
  const prefix = normalizePrefix(options.prefix ?? documentNumberPrefixForType(options.docType));
  const date = formatDocumentNumberDate(options.date ?? new Date());

  return `${prefix}-${date}-${suffix}`;
}
