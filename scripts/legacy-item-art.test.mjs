import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { LEGACY_ITEM_ART } from "../shared/legacy-item-art.ts";
import { starterItems } from "../shinobij.client/src/data/starter-items.ts";

const ROOT = join(import.meta.dirname, "..");
const ITEMS = join(ROOT, "shinobij.client", "public", "items");
const entries = Object.entries(LEGACY_ITEM_ART);

test("the table covers the 30 refreshed base pictures (29 shop pieces and the kunai)", () => {
    assert.equal(entries.length, 30);
    assert.equal(entries.filter(([old]) => old.startsWith("shop-") && old.endsWith("-v1.webp")).length, 29);
    assert.equal(LEGACY_ITEM_ART["starter-rustfang-kunai-v2.webp"], "starter-rustfang-kunai-v3.webp");
});

test("every old name is really gone, and every target exists and is what the game uses", () => {
    const used = new Set(starterItems.map((item) => item.image).filter(Boolean).map((image) => image.replace("/items/", "")));
    for (const [old, now] of entries) {
        assert.equal(existsSync(join(ITEMS, old)), false, `${old} should have been deleted (a file here would shadow the redirect)`);
        assert.ok(existsSync(join(ITEMS, now)), `${now} is missing`);
        assert.ok(used.has(now), `${now} is not the art of any built in item`);
    }
});

test("a name never redirects to itself or to another old name", () => {
    const olds = new Set(entries.map(([old]) => old));
    for (const [old, now] of entries) {
        assert.notEqual(old, now);
        assert.equal(olds.has(now), false, `${old} chains into ${now}`);
    }
});

test("server.ts registers the redirect before the static handler, so an old name never reaches a 404", () => {
    const server = readFileSync(join(ROOT, "server.ts"), "utf8");
    const redirect = server.indexOf("LEGACY_ITEM_ART[req.params[0]]");
    const statics = server.indexOf("app.use(express.static(staticDir");
    const notFound = server.indexOf("Static asset not found");
    assert.ok(redirect > 0 && statics > redirect && notFound > redirect, "redirect must come before static and the 404 guard");
    assert.match(server, /res\.redirect\(302, `\/items\/\$\{renamed\}`\)/);
});
