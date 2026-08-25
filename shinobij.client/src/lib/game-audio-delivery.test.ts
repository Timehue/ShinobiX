/*
 * Asset-side guards for compressed audio delivery. The picker's LOGIC is tested
 * behaviourally in audio-delivery.test.ts; what is left to protect here is that
 * the files it points at actually exist, and that game-audio.ts keeps its
 * fallback to the shipped master. Both fail silently in production — a missing
 * sibling is a 404 the player experiences as no sound, or as a 12x download.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const engineSource = readFileSync(path.join(here, "game-audio.ts"), "utf8");
const publicDir = path.resolve(here, "..", "..", "public");
const productionDir = path.join(publicDir, "sfx", "production");
const musicDir = path.join(publicDir, "music");

test("the WAV master remains the last resort, so a missing sibling is never silence", () => {
    assert.match(
        engineSource,
        /if \(!buffer && delivery !== path\)/,
        "loadBuffer must retry the master when the compressed sibling fails to fetch or decode",
    );
});

test("every sfx cue the engine names has both delivery siblings on disk", () => {
    const referenced = [...engineSource.matchAll(/"\/sfx\/production\/([^"]+)\.wav"/g)].map((m) => m[1]);
    assert.ok(referenced.length >= 25, `expected the full cue manifest, found ${referenced.length}`);

    const missing: string[] = [];
    const notSmaller: string[] = [];
    for (const cue of referenced) {
        const master = path.join(productionDir, `${cue}.wav`);
        for (const ext of [".ogg", ".m4a"]) {
            const sibling = path.join(productionDir, `${cue}${ext}`);
            if (!existsSync(sibling)) { missing.push(`${cue}${ext}`); continue; }
            if (statSync(sibling).size >= statSync(master).size) notSmaller.push(`${cue}${ext}`);
        }
    }
    assert.deepEqual(missing, [], "run `node scripts/encode-audio.mjs` to regenerate delivery audio");
    assert.deepEqual(notSmaller, [], "a delivery file larger than its master defeats the point");
});

test("every .ogg music track has an .m4a sibling, or it is silent on iOS", () => {
    const oggs: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith(".ogg")) oggs.push(p);
        }
    };
    walk(musicDir);
    assert.ok(oggs.length >= 8, `expected the authored music tracks, found ${oggs.length}`);

    const missing = oggs
        .map((o) => o.replace(/\.ogg$/, ".m4a"))
        .filter((m) => !existsSync(m))
        .map((m) => path.relative(publicDir, m));
    assert.deepEqual(
        missing,
        [],
        "WebKit decodes no Ogg container, so an .ogg without an .m4a sibling plays nothing "
        + "on Safari/iOS. Run `node scripts/encode-audio.mjs`.",
    );
});

test("both music players route through the delivery picker", () => {
    for (const file of ["pet-music.ts", "vn-cinematic-score.ts"]) {
        const source = readFileSync(path.join(here, file), "utf8");
        const assignments = [...source.matchAll(/\.src = ([^;]+);/g)].map((m) => m[1].trim());
        assert.ok(assignments.length > 0, `${file} should assign an audio src`);
        for (const value of assignments) {
            assert.match(
                value,
                /musicDeliverySrc\(/,
                `${file} assigns \`${value}\` directly; route it through musicDeliverySrc so `
                + "Safari/iOS gets the .m4a sibling instead of an Ogg it cannot decode",
            );
        }
    }
});
