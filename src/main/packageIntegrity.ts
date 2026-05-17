import { createHash } from "node:crypto";

export function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function assertPackageContentMatchesHash(content: string, expectedSha256: string): void {
  if (sha256Base64Url(content) !== expectedSha256) {
    throw new Error("Saved secure HTML file no longer matches publish history. Recreate the package before sending email.");
  }
}
