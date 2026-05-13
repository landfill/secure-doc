export const PIN_MIN_LENGTH = 6;
export const PIN_MAX_LENGTH = 15;
export const GENERATED_PIN_LENGTH = 12;
export const DEFAULT_PIN_KDF_ITERATIONS = 1_000_000;
export const COMPAT_PIN_KDF_ITERATIONS = 600_000;

const GENERATED_PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_=+?";
const GENERATED_PIN_BUCKET_SIZE = Math.floor(256 / GENERATED_PIN_ALPHABET.length) * GENERATED_PIN_ALPHABET.length;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

export type PinPolicyResult =
  | { valid: true; normalizedPin: string; message: string }
  | { valid: false; normalizedPin: string; message: string };

export interface PinRandomSource {
  getRandomValues(array: Uint8Array): Uint8Array;
}

export function normalizePin(input: string): string {
  return input.normalize("NFKC").trim();
}

function hasValidLength(pin: string): boolean {
  const length = [...pin].length;
  return length >= PIN_MIN_LENGTH && length <= PIN_MAX_LENGTH;
}

function isRepeatedCharacter(pin: string): boolean {
  return /^([\s\S])\1+$/.test(pin);
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

export function evaluatePinPolicy(input: string): PinPolicyResult {
  const normalizedPin = normalizePin(input);

  if (!hasValidLength(normalizedPin) || CONTROL_CHARACTERS.test(normalizedPin)) {
    return {
      valid: false,
      normalizedPin,
      message: "PIN은 숫자, 문자, 기호를 포함해 6자리 이상 15자리 이내여야 합니다."
    };
  }

  if (isRepeatedCharacter(normalizedPin) || isSequentialDigitRun(normalizedPin)) {
    return {
      valid: false,
      normalizedPin,
      message: "반복 문자나 연속 숫자 PIN은 사용할 수 없습니다."
    };
  }

  return {
    valid: true,
    normalizedPin,
    message: "PIN 정책을 충족합니다."
  };
}

export function assertValidPin(input: string): string {
  const result = evaluatePinPolicy(input);
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
    throw new Error("Generated PIN length must be between 6 and 15 characters.");
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
