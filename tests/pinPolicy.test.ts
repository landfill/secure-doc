import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePinPolicy, generateNumericPin, normalizePin } from "../src/shared/pinPolicy.ts";

test("normalizes full-width digits and preserves leading zero", () => {
  assert.equal(normalizePin(" ００１２３４ "), "001234");
  const result = evaluatePinPolicy(" ００１２３４ ");
  assert.equal(result.valid, true);
  assert.equal(result.normalizedPin, "001234");
});

test("blocks obvious weak six-digit PINs", () => {
  for (const pin of ["000000", "111111", "123456", "654321"]) {
    const result = evaluatePinPolicy(pin);
    assert.equal(result.valid, false, pin);
  }
});

test("generates six-digit PINs from cryptographic random values and skips weak values", () => {
  const values = [123456, 42];
  const source = {
    getRandomValues(array: Uint32Array): Uint32Array {
      array[0] = values.shift() ?? 482913;
      return array;
    }
  };

  assert.equal(generateNumericPin(source), "000042");
});

