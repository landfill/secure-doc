import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(path);
      }
      if (/\.(ts|tsx|html|css)$/.test(entry.name)) {
        return [path];
      }
      return [];
    })
  );
  return files.flat();
}

test("source does not use weak random, browser storage, or numeric PIN input type", async () => {
  const files = await collectSourceFiles("src");
  const combined = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");

  assert.equal(combined.includes("Math.random"), false);
  assert.equal(combined.includes("localStorage"), false);
  assert.equal(combined.includes("sessionStorage"), false);
  assert.equal(combined.includes('type="number"'), false);
});

