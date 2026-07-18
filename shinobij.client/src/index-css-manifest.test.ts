import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// ─── index.css manifest guard (anti-regrowth guardrail) ─────────────────────
// index.css was a 27,835-line append-only monolith, split 2026-07-18 into
// ordered part files under src/styles/index/NN-*.css. It is now a PURE
// @import manifest, and cascade order across the parts is load-bearing: the
// styles grew as override passes, so later files intentionally win
// specificity ties (see also main.tsx, where late-normalize.css and
// veiled-steel.css load after index.css for the same reason).
//
// This test fails if any CSS rule lands back in index.css. New styles belong
// in the matching part file — or a NEW numbered part imported at the END of
// the manifest, never above an override pass that must beat it.

test("index.css stays a pure @import manifest (no rules regrow in it)", () => {
  const url = new URL("./index.css", import.meta.url);
  const src = readFileSync(url, "utf8");
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const offending = withoutComments
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^@import "\.\/styles\/[\w./-]+\.css";$/.test(line));
  assert.deepEqual(
    offending,
    [],
    `index.css must contain only @import statements. Move these lines into the ` +
      `matching src/styles/index/NN-*.css part (or a new numbered part imported ` +
      `at the end):\n${offending.join("\n")}`,
  );
});

test("every index.css @import points at a file that exists", () => {
  const url = new URL("./index.css", import.meta.url);
  const src = readFileSync(url, "utf8");
  const imports = [...src.matchAll(/@import "(\.\/styles\/[\w./-]+\.css)";/g)].map(
    (m) => m[1],
  );
  assert.ok(imports.length >= 30, `expected the full manifest, found ${imports.length} imports`);
  for (const rel of imports) {
    const target = new URL(rel, url);
    assert.ok(existsSync(target), `index.css imports missing file: ${rel}`);
  }
});
