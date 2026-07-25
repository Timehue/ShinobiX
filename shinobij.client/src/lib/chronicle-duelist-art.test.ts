import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  CHRONICLE_KEEPER_NAME,
  CHRONICLE_KEEPER_PORTRAIT,
  chronicleDuelistAvatar,
  isChronicleKeeper,
} from "./chronicle-duelist-art.js";

/** Tests may run from the repo root or from shinobij.client. */
function clientRoot(): string {
  const nested = path.join(process.cwd(), "shinobij.client");
  return existsSync(nested) ? nested : process.cwd();
}

test("the Chronicle Keeper falls back to its bundled portrait", () => {
  assert.equal(chronicleDuelistAvatar(CHRONICLE_KEEPER_NAME), CHRONICLE_KEEPER_PORTRAIT);
  assert.equal(chronicleDuelistAvatar("chronicle keeper"), CHRONICLE_KEEPER_PORTRAIT);
  assert.equal(chronicleDuelistAvatar("  Chronicle Keeper  "), CHRONICLE_KEEPER_PORTRAIT);
  assert.ok(isChronicleKeeper("CHRONICLE KEEPER"));
});

test("only the Keeper gets the fallback — avatarless players keep their initials", () => {
  assert.equal(chronicleDuelistAvatar("Akari"), undefined);
  assert.equal(chronicleDuelistAvatar(""), undefined);
  assert.equal(chronicleDuelistAvatar(undefined), undefined);
  assert.equal(chronicleDuelistAvatar("Keeper"), undefined);
  assert.equal(chronicleDuelistAvatar("Chronicle Keeper Ren"), undefined);
});

test("an uploaded avatar always wins over the fallback", () => {
  const shared = {
    "avatar:akari": "/api/img?id=avatar:akari",
    "avatar:chronicle keeper": "/api/img?id=avatar:chronicle%20keeper",
  };
  assert.equal(chronicleDuelistAvatar("Akari", shared), shared["avatar:akari"]);
  assert.equal(
    chronicleDuelistAvatar(CHRONICLE_KEEPER_NAME, shared),
    shared["avatar:chronicle keeper"],
  );
});

test("the Keeper portrait exists and decodes", async () => {
  const file = path.join(clientRoot(), "public", CHRONICLE_KEEPER_PORTRAIT.slice(1));
  assert.equal(existsSync(file), true, CHRONICLE_KEEPER_PORTRAIT);
  const metadata = await sharp(file).metadata();
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512, "square, because the avatar tile is square");
  // Force pixel decoding instead of trusting the file header alone.
  await sharp(file).resize(1, 1, { fit: "fill" }).toBuffer();
});

test("the Keeper name still matches the name the server gives the AI", () => {
  const repoRoot = path.resolve(clientRoot(), "..");
  const engine = readFileSync(
    path.join(repoRoot, "api", "card-clash", "_ai-engine.ts"),
    "utf8",
  );
  assert.ok(
    engine.includes(`"${CHRONICLE_KEEPER_NAME}"`),
    "createAiMatch no longer names the AI 'Chronicle Keeper' — the portrait lookup is keyed on that name and would silently fall back to initials.",
  );
});
