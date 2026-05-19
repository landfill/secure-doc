import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getTranslationCompletenessErrors,
  resolveLocale,
  translate
} from "../src/shared/i18n.ts";

test("i18n resources include the same keys and placeholders for every locale", () => {
  assert.deepEqual(getTranslationCompletenessErrors(), []);
});

test("locale resolution falls back to the default language", () => {
  assert.equal(DEFAULT_LOCALE, "ko");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("fr"), "ko");
  assert.deepEqual(SUPPORTED_LOCALES, ["ko", "en"]);
});

test("translations interpolate without exposing unresolved placeholders", () => {
  assert.equal(translate("en", "viewer.pinHelp", { min: 6, max: 15 }), "6-15 character PIN");
  assert.equal(translate("ko", "policy.pinLength", { min: 6, max: 15 }), "PIN 6-15자리");
  assert.equal(translate("en", "email.sent", { suffix: " (message-1)" }), "Email sent (message-1)");
});
