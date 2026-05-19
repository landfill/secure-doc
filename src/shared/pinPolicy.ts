import { DEFAULT_LOCALE, translate, type Locale } from "./i18n.ts";

export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 15;
export const GENERATED_PIN_LENGTH = 12;
export const DEFAULT_PIN_KDF_ITERATIONS = 1_000_000;

const GENERATED_PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_=+?";
const GENERATED_PIN_BUCKET_SIZE = Math.floor(256 / GENERATED_PIN_ALPHABET.length) * GENERATED_PIN_ALPHABET.length;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export type PinPolicyResult =
  | { valid: true; normalizedPin: string; message: string }
  | { valid: false; normalizedPin: string; message: string };

export interface PinPolicyOptions {
  minLength?: number;
  maxLength?: number;
  locale?: Locale;
}

export interface PinRandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

export function normalizePin(input: string): string {
  return input.normalize("NFKC").trim();
}

function normalizePolicyLength(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function hasValidLength(pin: string, minLength: number, maxLength: number): boolean {
  const length = [...pin].length;
  return length >= minLength && length <= maxLength;
}

function isRepeatedCharacter(pin: string): boolean {
  const characters = [...pin];
  return characters.length > 1 && characters.every((character) => character === characters[0]);
}

function isSequentialDigitRun(pin: string): boolean {
  if (!/^[0-9]+$/.test(pin)) {
    return false;
  }
  const digits = [...pin].map(Number);
  const forward = digits.every((digit, index) => digit === (digits[0] + index) % 10);
  const backward = digits.every((digit, index) => digit === (digits[0] - index + 100) % 10);
  return forward || backward;
}

export function evaluatePinPolicy(input: string, options: PinPolicyOptions = {}): PinPolicyResult {
  const normalizedPin = normalizePin(input);
  const minLength = normalizePolicyLength(options.minLength, PIN_MIN_LENGTH);
  const maxLength = normalizePolicyLength(options.maxLength, PIN_MAX_LENGTH);
  const locale = options.locale ?? DEFAULT_LOCALE;

  if (!hasValidLength(normalizedPin, minLength, maxLength) || CONTROL_CHARACTERS.test(normalizedPin)) {
    return {
      valid: false,
      normalizedPin,
      message: translate(locale, "pin.error.length", { min: minLength, max: maxLength })
    };
  }

  if (isRepeatedCharacter(normalizedPin) || isSequentialDigitRun(normalizedPin)) {
    return {
      valid: false,
      normalizedPin,
      message: translate(locale, "pin.error.weak")
    };
  }

  return {
    valid: true,
    normalizedPin,
    message: translate(locale, "pin.ok")
  };
}

export function assertValidPin(input: string, options: PinPolicyOptions = {}): string {
  const result = evaluatePinPolicy(input, options);
  if (!result.valid) {
    throw new Error(result.message);
  }
  return result.normalizedPin;
}

export function generatePin(source: PinRandomSource = globalThis.crypto, length = GENERATED_PIN_LENGTH): string {
  if (!source?.getRandomValues) {
    throw new Error("A cryptographically secure random source is required.");
  }
  if (!Number.isInteger(length) || length < PIN_MIN_LENGTH || length > PIN_MAX_LENGTH) {
    throw new Error(`Generated PIN length must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH} characters.`);
  }

  const random = new Uint8Array(length);

  for (;;) {
    let pin = "";
    while (pin.length < length) {
      source.getRandomValues(random);
      for (const byte of random) {
        if (byte >= GENERATED_PIN_BUCKET_SIZE) {
          continue;
        }
        pin += GENERATED_PIN_ALPHABET[byte % GENERATED_PIN_ALPHABET.length];
        if (pin.length === length) {
          break;
        }
      }
    }

    if (evaluatePinPolicy(pin).valid) {
      return pin;
    }
  }
}
