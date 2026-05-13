import test from "node:test";
import assert from "node:assert/strict";
import { GENERATED_PIN_LENGTH, evaluatePinPolicy, generatePin, normalizePin } from "../src/shared/pinPolicy.ts";

test("normalizes full-width digits and preserves leading zero", () => {
  assert.equal(normalizePin(" ００１２３４ "), "001234");
  const result = evaluatePinPolicy(" ００１２３４ ");
  assert.equal(result.valid, true);
  assert.equal(result.normalizedPin, "001234");
});

test("accepts PINs from six to fifteen characters with letters, numbers, and symbols", () => {
  for (const pin of ["001234", "Abc123!", "한글PIN-12", "908172635401234"]) {
    const result = evaluatePinPolicy(pin);
    assert.equal(result.valid, true, pin);
    assert.equal(result.normalizedPin, pin);
  }
});

test("rejects PINs outside the length range or with control characters", () => {
  for (const pin of ["12345", "1234567890123456", "abc12\n345"]) {
    const result = evaluatePinPolicy(pin);
    assert.equal(result.valid, false, pin);
  }
});

test("blocks obvious weak PINs across the allowed range", () => {
  for (const pin of ["000000", "aaaaaaaaaaaa", "😀😀😀😀😀😀", "123456", "654321", "012345678901"]) {
    const result = evaluatePinPolicy(pin);
    assert.equal(result.valid, false, pin);
  }
});

test("generates a default-length mixed PIN from cryptographic random values and skips weak values", () => {
  const chunks = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  ];
  const source = {
    getRandomValues(array: Uint8Array): Uint8Array {
      const next = chunks.shift() ?? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      for (let index = 0; index < array.length; index += 1) {
        array[index] = next[index] ?? 0;
      }
      return array;
    }
  };

  const pin = generatePin(source);
  assert.equal(pin, "ABCDEFGHJKLM");
  assert.equal(pin.length, GENERATED_PIN_LENGTH);
});
