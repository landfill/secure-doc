export const PIN_LENGTH = 6;
export const PIN_SPACE_SIZE = 1_000_000;
export const DEFAULT_PIN_KDF_ITERATIONS = 1_000_000;
export const COMPAT_PIN_KDF_ITERATIONS = 600_000;

const EXPLICITLY_BLOCKED_PINS = new Set([
  "000000",
  "111111",
  "222222",
  "333333",
  "444444",
  "555555",
  "666666",
  "777777",
  "888888",
  "999999",
  "123456",
  "654321",
  "012345",
  "543210"
]);

export type PinPolicyResult =
  | { valid: true; normalizedPin: string; message: string }
  | { valid: false; normalizedPin: string; message: string };

export interface PinRandomSource {
  getRandomValues(array: Uint32Array): Uint32Array;
}

export function normalizePin(input: string): string {
  return input.normalize("NFKC").trim();
}

export function evaluatePinPolicy(input: string): PinPolicyResult {
  const normalizedPin = normalizePin(input);

  if (!/^[0-9]{6}$/.test(normalizedPin)) {
    return {
      valid: false,
      normalizedPin,
      message: "PIN은 앞자리 0을 포함할 수 있는 숫자 6자리여야 합니다."
    };
  }

  if (EXPLICITLY_BLOCKED_PINS.has(normalizedPin)) {
    return {
      valid: false,
      normalizedPin,
      message: "연속 숫자나 같은 숫자 반복 PIN은 사용할 수 없습니다."
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

export function generateNumericPin(source: PinRandomSource = globalThis.crypto): string {
  if (!source?.getRandomValues) {
    throw new Error("A cryptographically secure random source is required.");
  }

  const limit = 0x1_0000_0000 - (0x1_0000_0000 % PIN_SPACE_SIZE);
  const random = new Uint32Array(1);

  for (;;) {
    do {
      source.getRandomValues(random);
    } while (random[0] >= limit);

    const pin = String(random[0] % PIN_SPACE_SIZE).padStart(PIN_LENGTH, "0");
    if (evaluatePinPolicy(pin).valid) {
      return pin;
    }
  }
}

