import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
    CANVAS, MANIFEST_PATH, ITEMS_DIR, buildManifestRows, manifestCsv, processArt, readyListSource, stepArtOnDisk,
} from "./gear-step-art.mjs";
import { starterItems } from "../shinobij.client/src/data/starter-items.ts";
import { buildGearSteps, gearStepArtPath, parseStepItemId } from "../shared/gear-steps.ts";
import { GEAR_STEP_ART_READY } from "../shared/gear-step-art-ready.ts";

const ROOT = join(import.meta.dirname, "..");
const rows = buildManifestRows();

test("the manifest covers every step item exactly once", () => {
    assert.equal(rows.length, 110);
    assert.equal(rows.filter((row) => row.kind === "weapon").length, 65);
    assert.equal(rows.filter((row) => row.kind === "armor").length, 45);
    assert.equal(new Set(rows.map((row) => row.step_id)).size, 110);
    assert.equal(new Set(rows.map((row) => row.file_name)).size, 110);
    const catalog = starterItems.filter((item) => parseStepItemId(item.id)).map((item) => item.id).sort();
    assert.deepEqual(rows.map((row) => row.step_id).sort(), catalog);
});

test("every row points at a reference image that exists", () => {
    for (const row of rows) assert.ok(existsSync(join(ROOT, row.reference_image)), `${row.step_id}: ${row.reference_image}`);
});

test("each row carries its value, rung and a complete prompt", () => {
    const hood = rows.find((row) => row.step_id === "cloth-hood-s1");
    assert.equal(hood.value, "1.5% damage reduction");
    assert.equal(hood.rung, "1 of 3");
    assert.match(hood.prompt, /Violet Shade Hood, rung 1 of 3 between Standard armor and Reinforced armor/);
    const kunai = rows.find((row) => row.step_id === "rustfang-kunai-s5");
    assert.equal(kunai.value, "16.5 EP");
    assert.match(kunai.prompt, /Emberweave Kunai, rung 5 of 5 between Common weapons and Rare weapons/);
    for (const row of rows) {
        assert.match(row.prompt, /flat solid magenta \(#FF00FF\) background/, row.step_id);
        assert.match(row.prompt, /clearly less impressive than/, row.step_id);
    }
});

test("the committed manifest is current (regenerate with: node --import tsx scripts/gear-step-art.mjs manifest)", () => {
    assert.equal(readFileSync(MANIFEST_PATH, "utf8").replaceAll("\r\n", "\n"), manifestCsv(rows));
});

test("the ready list and the art files on disk are the same set", () => {
    assert.deepEqual([...GEAR_STEP_ART_READY].sort(), stepArtOnDisk());
    assert.equal(readFileSync(join(ROOT, "shared", "gear-step-art-ready.ts"), "utf8").replaceAll("\r\n", "\n"), readyListSource(GEAR_STEP_ART_READY));
});

test("a step item uses its own art only once it is ready, and its base art before then", () => {
    const base = starterItems.filter((item) => !parseStepItemId(item.id));
    const baseImage = new Map(base.map((item) => [item.id, item.image]));
    for (const step of starterItems.filter((item) => parseStepItemId(item.id))) {
        const ready = GEAR_STEP_ART_READY.includes(step.id);
        assert.equal(step.image, ready ? gearStepArtPath(step.id) : baseImage.get(parseStepItemId(step.id).baseId), step.id);
    }
    const ids = new Set(["rustfang-kunai-s2"]);
    const built = buildGearSteps(base, ids);
    assert.equal(built.find((item) => item.id === "rustfang-kunai-s2").image, "/items/step-rustfang-kunai-s2-v1.webp");
    assert.equal(built.find((item) => item.id === "rustfang-kunai-s3").image, baseImage.get("rustfang-kunai"));
});

// A synthetic "ChatGPT" picture: a dark blue blade on a flat magenta field, soft edged.
async function picture({ size = 512, offset = 90, background = [255, 0, 255, 255], clip = false } = {}) {
    const raw = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) raw.set(background, i * 4);
    const left = clip ? 0 : offset;
    for (let y = offset; y < size - offset; y++) {
        for (let x = left; x < size - offset; x++) raw.set([20, 40, 110, 255], (y * size + x) * 4);
    }
    return sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

async function alphaAt(buffer, x, y) {
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    return data[(y * info.width + x) * info.channels + 3];
}

test("a magenta background is removed and the item is framed on a 320 canvas", async () => {
    const result = await processArt(await picture());
    assert.deepEqual(result.problems, []);
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, CANVAS);
    assert.equal(meta.height, CANVAS);
    assert.equal(await alphaAt(result.buffer, 2, 2), 0, "the corner is transparent");
    assert.equal(await alphaAt(result.buffer, CANVAS / 2, CANVAS / 2), 255, "the item is solid");
    assert.ok(result.buffer.length < 40_000);
});

test("no magenta is left on the item", async () => {
    const { buffer } = await processArt(await picture());
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < info.width * info.height; i++) {
        if (data[i * 4 + 3] < 200) continue;
        const [r, g, b] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
        assert.ok(!(r > 200 && b > 200 && g < 80), `magenta pixel at ${i}`);
    }
});

test("real item art on magenta comes out without a pink fringe", async () => {
    for (const file of ["starter-rustfang-kunai-v2", "shop-reinforced-vest-v1", "shop-ashglass-katana-v1", "shop-iron-kabuto-v1"]) {
        const subject = await sharp(join(ITEMS_DIR, `${file}.webp`)).resize(900, 900, { fit: "inside" }).png().toBuffer();
        const onMagenta = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#ff00ff" } })
            .composite([{ input: subject, gravity: "center" }]).png().toBuffer();
        const result = await processArt(onMagenta);
        assert.deepEqual(result.problems, [], file);
        const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
        let visible = 0;
        let pink = 0;
        for (let i = 0; i < info.width * info.height; i++) {
            if (data[i * 4 + 3] === 0) continue;
            visible++;
            if (data[i * 4] > data[i * 4 + 1] + 25 && data[i * 4 + 2] > data[i * 4 + 1] + 25) pink++;
        }
        assert.ok(pink / visible < 0.01, `${file}: ${(100 * pink / visible).toFixed(2)} percent pink`);
    }
});

test("a genuinely purple item keeps its colour while the magenta around it goes", async () => {
    const size = 512;
    const raw = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) raw.set([255, 0, 255, 255], i * 4);
    for (let y = 90; y < size - 90; y++) for (let x = 90; x < size - 90; x++) raw.set([120, 60, 160, 255], (y * size + x) * 4);
    const result = await processArt(await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer());
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    const middle = ((CANVAS / 2) * info.width + CANVAS / 2) * 4;
    assert.deepEqual([...data.slice(middle, middle + 4)], [120, 60, 160, 255]);
    assert.equal(data[3], 0);
});

test("any flat background colour is keyed out, not only magenta", async () => {
    const result = await processArt(await picture({ background: [236, 236, 230, 255] }));
    assert.deepEqual(result.problems, []);
    assert.equal(await alphaAt(result.buffer, 2, 2), 0);
});

test("a translucent film background is cleaned to a cutout", async () => {
    const result = await processArt(await picture({ background: [255, 255, 255, 77] }));
    assert.deepEqual(result.problems, []);
    assert.equal(await alphaAt(result.buffer, 2, 2), 0);
    assert.equal(await alphaAt(result.buffer, CANVAS / 2, CANVAS / 2), 255);
});

test("a picture that crops the item, or shows nothing, is rejected with a reason", async () => {
    const clipped = await processArt(await picture({ clip: true }));
    assert.match(clipped.problems.join(";"), /cropped/);
    const empty = await processArt(await picture({ offset: 256 }));
    assert.ok(empty.buffer === null || empty.problems.length > 0);
});

test("the import command is documented, and the handoff names the same file pattern", () => {
    const doc = readFileSync(join(ROOT, "docs", "gear-step-art-handoff.md"), "utf8");
    assert.ok(doc.includes("gear-step-art.mjs import"), "handoff explains the import command");
    assert.ok(doc.includes("<stepId>.png") || doc.includes("file_name"), "handoff explains the file names");
    assert.ok(existsSync(ITEMS_DIR));
});
