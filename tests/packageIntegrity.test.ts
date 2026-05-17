import test from "node:test";
import assert from "node:assert/strict";
import { assertPackageContentMatchesHash, sha256Base64Url } from "../src/main/packageIntegrity.ts";

test("accepts saved package content when the publish history hash matches", () => {
  const content = "<!doctype html><title>Secure package</title>";
  assert.doesNotThrow(() => assertPackageContentMatchesHash(content, sha256Base64Url(content)));
});

test("rejects saved package content that was modified after publication", () => {
  const publishedContent = "<!doctype html><title>Secure package</title>";
  const tamperedContent = "<!doctype html><body>Plain confidential body</body>";

  assert.throws(
    () => assertPackageContentMatchesHash(tamperedContent, sha256Base64Url(publishedContent)),
    /no longer matches publish history/
  );
});
