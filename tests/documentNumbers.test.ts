import test from "node:test";
import assert from "node:assert/strict";
import { documentNumberPrefixForType, generatePresetDocumentNumber } from "../src/shared/documentNumbers.ts";

test("preset document number includes document type prefix, creation date, and alphanumeric suffix", () => {
  const documentNumber = generatePresetDocumentNumber({
    docType: "보험증서",
    date: new Date(2026, 4, 20),
    randomBytes: () => Uint8Array.from([0, 1, 24, 25])
  });

  assert.match(documentNumber, /^INS-20260520-[A-Z0-9]{4}$/);
  assert.match(documentNumber, /[A-Z]/);
  assert.match(documentNumber, /\d/);
});

test("document number prefix falls back to generic documents", () => {
  assert.equal(documentNumberPrefixForType("보험증서"), "INS");
  assert.equal(documentNumberPrefixForType("알 수 없음"), "DOC");
});

test("preset document number suffix is forced to contain letters and digits", () => {
  const allLetters = generatePresetDocumentNumber({
    date: new Date(2026, 4, 20),
    randomBytes: () => Uint8Array.from([0, 1, 2, 3])
  });
  const allDigits = generatePresetDocumentNumber({
    date: new Date(2026, 4, 20),
    randomBytes: () => Uint8Array.from([24, 25, 26, 27])
  });

  for (const documentNumber of [allLetters, allDigits]) {
    const suffix = documentNumber.split("-").at(-1) ?? "";
    assert.match(suffix, /[A-Z]/);
    assert.match(suffix, /\d/);
  }
});
