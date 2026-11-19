import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ─── Hush defender art framing gate ─────────────────────────────────────────
// The vault boss room shows public/hush/<slug>.webp at 168px (HushVaultRaid's
// Challenge modal). The first batch of that art was generated with a prompt
// that asked for a "centered" figure but never asked for MARGIN, so gpt-image-1
// composed all four edge to edge: every hood crown and every boot sole was
// sliced flat by the frame, and players met a Hush with the top of his head
// missing. `object-fit: contain` cannot rescue that — the pixels were gone.
//
// This gate names the four files and fails if a subject ever runs into the
// frame again. It covers ONLY these four; new village art must be added here.
// Repair path when it fails: node scripts/fix-hush-framing.mjs (see its header).
const CLIENT_ROOT = join(import.meta.dirname, "..", "..", "..");
const REPO_ROOT = join(CLIENT_ROOT, "..");
const ART_DIR = join(CLIENT_ROOT, "public", "hush");
const API_SRC = join(CLIENT_ROOT, "src", "lib", "hush-infiltration-api.ts");
// The server's canonical war-village list. Every village that can own a sector
// can be the vault's defender, so every one of them needs a portrait.
const WAR_VILLAGES_SRC = join(REPO_ROOT, "api", "_war-map-sectors.ts");

// Alpha at or above this is the figure; below it is background or the soft
// edge. Matches the INK threshold the repair script measures with.
const INK = 128;
// Every side must keep at least this fraction of the frame clear. The repaired
// art sits at ~3%; anything under this is a crop waiting to be noticed.
const MIN_MARGIN = 0.015;

// Read as TEXT rather than imported: hush-infiltration-api.ts is browser-side
// (it reaches for localStorage for the presentation flag), and the api module is
// server-side, so neither imports cleanly into a node:test process.
function villageToSlug(): Map<string, string> {
    const src = readFileSync(API_SRC, "utf8");
    const block = src.match(/HUSH_AVATAR_BY_VILLAGE[^=]*=\s*\{([\s\S]*?)\}/);
    assert.ok(block, "HUSH_AVATAR_BY_VILLAGE not found in hush-infiltration-api.ts");
    return new Map([...block[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)].map(m => [m[1], m[2]]));
}

function warVillages(): string[] {
    const src = readFileSync(WAR_VILLAGES_SRC, "utf8");
    const block = src.match(/WAR_VILLAGES:\s*readonly WarVillage\[\]\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(block, "WAR_VILLAGES not found in api/_war-map-sectors.ts");
    return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

test("every war village that can hold a vault has defender art wired to it", () => {
    const map = villageToSlug();
    const villages = warVillages();
    assert.ok(villages.length >= 4, "expected the four war villages");
    for (const village of villages) {
        const slug = map.get(village);
        assert.ok(slug, `${village} can own a sector but has no entry in HUSH_AVATAR_BY_VILLAGE ` +
            `— its vault would fall back to the placeholder emoji`);
        assert.ok(existsSync(join(ART_DIR, `${slug}.webp`)), `missing public/hush/${slug}.webp for ${village}`);
    }
});

test("the defender portrait URL carries a cache-busting revision", () => {
    const src = readFileSync(API_SRC, "utf8");
    // public/hush/*.webp is unhashed and served max-age=604800 behind a
    // stale-while-revalidate service worker, so replacing the art in place is
    // invisible to returning players unless the URL changes with it.
    assert.match(src, /return slug \? `\/hush\/\$\{slug\}\.webp\?v=\$\{HUSH_AVATAR_ASSET_REVISION\}` : null;/,
        "hushAvatarForVillage must stamp HUSH_AVATAR_ASSET_REVISION onto the URL");
    assert.match(src, /export const HUSH_AVATAR_ASSET_REVISION = \d+;/,
        "HUSH_AVATAR_ASSET_REVISION must be defined — bump it whenever the art is replaced in place");
});

test("every Hush defender portrait is framed clear of the canvas edges", async () => {
    let sharp: typeof import("sharp");
    try {
        sharp = (await import("sharp")).default as unknown as typeof import("sharp");
    } catch (err) {
        // sharp is a client dependency; the root runner's pretest installs it.
        // Only a genuinely absent module is tolerated — anything else is a bug.
        if ((err as NodeJS.ErrnoException)?.code !== "ERR_MODULE_NOT_FOUND") throw err;
        console.warn("skip: sharp is not installed, cannot decode the Hush webp files");
        return;
    }

    const slugs = [...villageToSlug().values()].sort();
    assert.deepEqual(slugs, ["ashenleaf", "frostfang", "moonshadow", "stormveil"],
        "village → art slug mapping changed; add the new art to this gate");

    for (const slug of slugs) {
        const file = join(ART_DIR, `${slug}.webp`);
        assert.ok(existsSync(file), `missing defender art: public/hush/${slug}.webp`);
        const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const { width: w, height: h, channels: ch } = info;

        let top = -1, bottom = -1, left = w, right = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (data[(y * w + x) * ch + 3] < INK) continue;
                if (top < 0) top = y;
                bottom = y;
                if (x < left) left = x;
                if (x > right) right = x;
            }
        }
        assert.ok(top >= 0, `${slug}.webp has no opaque pixels at all`);

        const margins = {
            top: top / h,
            bottom: (h - 1 - bottom) / h,
            left: left / w,
            right: (w - 1 - right) / w,
        };
        for (const [side, margin] of Object.entries(margins)) {
            assert.ok(margin >= MIN_MARGIN,
                `${slug}.webp runs into the ${side} edge (${(margin * 100).toFixed(1)}% clear, ` +
                `needs ${(MIN_MARGIN * 100).toFixed(1)}%) — the figure is cropped, not just tight`);
        }
    }
});
