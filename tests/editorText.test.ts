import test from "node:test";
import assert from "node:assert/strict";
import { removeUnsupportedEditorCharacters } from "../src/renderer/src/sanitizeHtml.ts";

test("removes Han characters while preserving Hangul and normalized numeric text", () => {
  assert.equal(removeUnsupportedEditorCharacters("참을 인(忍) １００% 갑을"), "참을 인() 100% 갑을");
});
