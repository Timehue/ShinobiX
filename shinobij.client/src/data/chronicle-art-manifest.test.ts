import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  CHRONICLE_CARD_CATALOG,
  CHRONICLE_FIELD_DEFINITIONS,
} from "../../../shared/chronicle-duel.js";
import { shinobiTileCards } from "./tile-cards.js";
import { buildChronicleArtManifest } from "./chronicle-art-manifest.js";

test("Chronicle art manifest covers every card and omits unsupported images", () => {
  const manifest = buildChronicleArtManifest(shinobiTileCards);
  assert.equal(manifest.length, CHRONICLE_CARD_CATALOG.length);
  assert.equal(
    new Set(manifest.map((row) => row.cardId)).size,
    CHRONICLE_CARD_CATALOG.length,
  );
  assert.equal(
    new Set(CHRONICLE_CARD_CATALOG.map((card) => card.image)).size,
    CHRONICLE_CARD_CATALOG.length,
    "every Chronicle card must have a distinct runtime art identity",
  );
  for (const row of manifest) {
    if (row.provenance === "omitted-no-matching-asset")
      assert.equal(row.runtimePath, undefined);
    else
      assert.ok(
        row.runtimePath?.startsWith("/") ||
          row.runtimePath?.startsWith("data:image/"),
      );
  }
});

test("every canonical runtime art path resolves to an existing asset", () => {
  const publicRoot = existsSync(
    path.join(process.cwd(), "shinobij.client", "public"),
  )
    ? path.join(process.cwd(), "shinobij.client", "public")
    : path.join(process.cwd(), "public");
  for (const row of buildChronicleArtManifest(shinobiTileCards)) {
    if (!row.runtimePath || !row.runtimePath.startsWith("/")) continue;
    assert.equal(
      existsSync(path.join(publicRoot, row.runtimePath.slice(1))),
      true,
      `${row.cardId}: ${row.runtimePath}`,
    );
  }
  assert.equal(
    existsSync(path.join(publicRoot, "chronicle", "card-back.webp")),
    true,
    "Chronicle card back",
  );
  for (const field of CHRONICLE_FIELD_DEFINITIONS) {
    assert.equal(
      existsSync(path.join(publicRoot, field.image.slice(1))),
      true,
      `${field.name} field environment`,
    );
  }
});

test("every local Chronicle image decodes successfully", async () => {
  const publicRoot = existsSync(
    path.join(process.cwd(), "shinobij.client", "public"),
  )
    ? path.join(process.cwd(), "shinobij.client", "public")
    : path.join(process.cwd(), "public");
  const runtimePaths = [
    ...buildChronicleArtManifest(shinobiTileCards).flatMap((row) =>
      row.runtimePath?.startsWith("/") ? [row.runtimePath] : [],
    ),
    "/chronicle/card-back.webp",
    ...CHRONICLE_FIELD_DEFINITIONS.map((field) => field.image),
  ];

  for (const runtimePath of new Set(runtimePaths)) {
    const file = path.join(publicRoot, runtimePath.slice(1));
    const metadata = await sharp(file).metadata();
    assert.ok(metadata.width && metadata.height, `${runtimePath}: dimensions`);
    // Force pixel decoding instead of checking only the file header.
    await sharp(file).resize(1, 1, { fit: "fill" }).toBuffer();
  }
});
