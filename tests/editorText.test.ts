import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedLinkHref, removeUnsupportedEditorCharacters } from "../src/renderer/src/sanitizeHtml.ts";

test("removes Han characters while preserving Hangul and normalized numeric text", () => {
  assert.equal(removeUnsupportedEditorCharacters("참을 인(忍) １００% 갑을"), "참을 인() 100% 갑을");
});

test("allows only supported safe link href formats", () => {
  assert.equal(isAllowedLinkHref("https://example.com/path?q=1"), true);
  assert.equal(isAllowedLinkHref("mailto:user@example.com"), true);
  assert.equal(isAllowedLinkHref("tel:+821012345678"), true);
  assert.equal(isAllowedLinkHref("http://example.com"), false);
  assert.equal(isAllowedLinkHref("javascript:alert(1)"), false);
  assert.equal(isAllowedLinkHref("https://example.com/<script>"), false);
  assert.equal(isAllowedLinkHref("https://exa mple.com"), false);
});
