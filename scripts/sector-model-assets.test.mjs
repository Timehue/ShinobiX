import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import test from "node:test";

const client = new URL("../shinobij.client/", import.meta.url);
const manifests = new URL("src/data/sector-models/", client);
const content = resolve(process.env.SECTOR_MODEL_TEST_CONTENT || fileURLToPath(new URL("../.ci-evidence/sector-models/", client)));
const hash = data => createHash("sha256").update(data).digest("hex");

async function verifyPackedNpc(model, slug) {
    assert.equal(model.heightFraction, .068);
    assert.deepEqual(model.directions, ["s","se","e","ne","n","nw","w","sw"]);
    assert.deepEqual(Object.keys(model.styles).sort(), ["A","B","C"]);
    const pages = new Set();
    for (const indexes of Object.values(model.styles)) {
        assert.equal(indexes.length, 8);
        for (const name of indexes) {
            assert.match(name,/^[a-f0-9]{64}\.gz$/);
            const data = await readFile(resolve(content,slug,name));
            assert.equal(hash(data)+".gz",name);
            const bank = JSON.parse(gunzipSync(data));
            // The five creature/spirit packages have an authored breathing or
            // hovering idle; humanoids retain the single planted idle pose.
            const idleFrames = ["bell-wraith", "ember-fox", "hollow-hound", "raiju-storm-hound", "riftspawn"].includes(slug) ? 48 : 1;
            for (const [gait,frames,speed] of [["idle",idleFrames,0],["walk",64,31],["run",36,120]]) {
                assert.equal(bank.clips[gait].count,frames);
                assert.equal(bank.clips[gait].speed,speed);
            }
            for (const clip of Object.values(bank.clips)) {
                const page=bank.pages[clip.file];
                assert.ok(page && (clip.firstCell ?? 0)+clip.count<=page.frames);
                assert.equal(clip.origins.length,clip.count);
                assert.match(page.file,/^[a-f0-9]{64}\.264$/);
                pages.add(page.file);
            }
        }
    }
    for (const name of pages)
        assert.equal(hash(await readFile(resolve(content,slug,name)))+".264",name);
}

test("the client pins each fitted model to the original portrait and published revision", async () => {
    const files = (await readdir(manifests)).filter(name => name.endsWith(".json"));
    for (const required of ["patrol.json", "medic.json", "starter-one.json", "starter-two.json"]) assert.ok(files.includes(required));
    for (const file of files) {
        const model = JSON.parse(await readFile(new URL(file, manifests), "utf8"));
        assert.match(model.portrait, /^(src\/assets|public)\/[\w./-]+\.webp$/);
        assert.ok(!model.portrait.split("/").includes(".."));
        assert.equal(hash(await readFile(new URL(model.portrait, client))), model.portraitSha256);
        if (file.startsWith("starter-")) {
            assert.equal(model.portrait, "public/starter-avatar-" + file.slice("starter-".length, -5) + ".webp");
        }
        assert.match(model.manifestSha256, /^[a-f0-9]{64}$/);
    }
});

test("the separately staged models have complete, immutable gait pages", { skip: !existsSync(content) }, async () => {
    for (const file of (await readdir(manifests)).filter(name => name.endsWith(".json"))) {
        const slug = file.slice(0, -5);
        const pin = JSON.parse(await readFile(new URL(file, manifests), "utf8"));
        const bytes = await readFile(resolve(content, slug, pin.manifestSha256 + ".json"));
        assert.equal(hash(bytes), pin.manifestSha256);
        const model = JSON.parse(bytes.toString("utf8"));
        assert.equal(model.portraitSha256, pin.portraitSha256);
        assert.equal(model.mapWidth, 1080);
        if (model.format === "sector-motion-v2") {
            await verifyPackedNpc(model,slug);
            continue;
        }
        assert.equal(model.banks.length, 8);
        const pages = new Set();
        for (const view of model.banks) {
            for (const [gait, frames, speed] of [["idle", 1, 0], ["walk", 64, 31], ["run", 36, 120]]) {
                const clip = view[gait];
                assert.equal(clip.origins.length, frames);
                assert.ok(clip.origins.every(pair => pair.length === 2 && pair.every(Number.isFinite)));
                assert.ok(clip.cell.length === 2 && clip.cell.every(n => Number.isInteger(n) && n > 0));
                assert.ok(Number.isInteger(clip.cols) && clip.cols >= 1 && clip.cols <= frames);
                assert.equal(clip.speed, speed);
                assert.ok(Number.isFinite(clip.period) && clip.period > 0);
                const name = clip.url.split("/").at(-1);
                assert.match(name, /^[a-f0-9]{64}\.webp$/);
                assert.equal(clip.url, `/sector-models/${slug}/${name}`);
                if (pages.has(name)) continue;
                const data = await readFile(resolve(content, slug, name));
                assert.equal(hash(data) + ".webp", name);
                pages.add(name);
            }
        }
    }
});
