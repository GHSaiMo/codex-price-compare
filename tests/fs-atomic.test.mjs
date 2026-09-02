import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { toFilePath, writeAtomic, writeJsonAtomic } from "../src/fs-atomic.mjs";

const tempDir = await mkdtemp(join(tmpdir(), "codex-atomic-test-"));

try {
  // Test 1: toFilePath handles paths and URLs
  const filePathStr = join(tempDir, "test.json");
  const fileUrl = pathToFileURL(filePathStr);
  assert.equal(toFilePath(filePathStr), filePathStr);
  assert.equal(toFilePath(fileUrl), filePathStr);
  assert.equal(toFilePath(fileUrl.href), filePathStr);

  // Test 2: writeJsonAtomic writes valid JSON
  const testData = { name: "test-item", count: 42, nested: { ok: true } };
  await writeJsonAtomic(filePathStr, testData);
  const readBack = JSON.parse(await readFile(filePathStr, "utf8"));
  assert.deepEqual(readBack, testData);

  // Test 3: writeJsonAtomic works with URL instances
  const testData2 = { fromUrl: true, timestamp: Date.now() };
  await writeJsonAtomic(fileUrl, testData2);
  const readBack2 = JSON.parse(await readFile(filePathStr, "utf8"));
  assert.deepEqual(readBack2, testData2);

  // Test 4: Concurrent writes and reads never read 0 bytes or corrupted data
  const targetFile = join(tempDir, "concurrent.json");
  await writeJsonAtomic(targetFile, { version: 0, items: [] });

  let readErrors = 0;
  let readSuccesses = 0;

  const writers = Array.from({ length: 20 }, async (_, i) => {
    for (let j = 0; j < 10; j++) {
      await writeJsonAtomic(targetFile, {
        writer: i,
        step: j,
        payload: Array.from({ length: 50 }, (_, k) => `data-chunk-${i}-${j}-${k}`),
      });
    }
  });

  const readers = Array.from({ length: 20 }, async () => {
    for (let j = 0; j < 20; j++) {
      try {
        const text = await readFile(targetFile, "utf8");
        const parsed = JSON.parse(text);
        assert.ok(parsed && typeof parsed === "object");
        readSuccesses++;
      } catch (err) {
        readErrors++;
      }
    }
  });

  await Promise.all([...writers, ...readers]);
  assert.equal(readErrors, 0, "No read/parse errors should occur during concurrent writes");
  assert.ok(readSuccesses > 0, "All reads should succeed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
