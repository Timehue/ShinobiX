import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";

const manifestUrl = new URL("./tower-art-manifest.ts", import.meta.url);
const manifest = readFileSync(manifestUrl, "utf8");
const fight = readFileSync(new URL("../screens/BattleTowerFight.tsx", import.meta.url), "utf8");
const lobby = readFileSync(new URL("../screens/BattleTowersLobby.tsx", import.meta.url), "utf8");
const lobbyCss = readFileSync(new URL("../styles/tower-lobby.css", import.meta.url), "utf8");
const floorCatalog = readFileSync(new URL("../../../api/towers/_floor-catalog.ts", import.meta.url), "utf8");

test("Tower art stays versioned, centralized, and honest about unknown combatants", async () => {
    const keyArt = new URL("../assets/towers/battle-towers-key-art-v1.webp", import.meta.url);
    assert.ok(statSync(keyArt).size > 100_000, "the versioned Tower key-art asset must be present");
    assert.match(manifest, /battle-towers-key-art-v1\.webp/);
    for (const key of ["bandit", "archer", "blocker", "brute", "acolyte", "warden", "ravager", "genin", "revenant", "sovereign", "stormcaller"] as const) {
        assert.match(manifest, new RegExp(`${key}:\\s*${key}(?:Sprite)?`), `${key} must remain in the central portrait manifest`);
    }
    assert.match(manifest, /"mirror-shogun":\s*mirrorShogunSprite/);
    assert.match(manifest, /"void-emperor":\s*voidEmperorSprite/);
    for (const asset of ["stormcaller.webp", "mirror-shogun.webp", "void-emperor.webp"]) {
        const portrait = new URL(`../assets/towers/enemies/${asset}`, import.meta.url);
        assert.ok(statSync(portrait).size > 10_000, `${asset} must contain production portrait art`);
    }
    for (const key of ["stormglass-lancer", "stormglass-marksman", "stormglass-bastion", "stormglass-weaver", "thunder-archivist", "stormglass-regent", "tower-scout"] as const) {
        assert.match(manifest, new RegExp(`"${key}":\\s*[a-zA-Z]+Sprite`), `${key} must remain in the central portrait manifest`);
        const portrait = new URL(`../assets/towers/enemies/${key}.webp`, import.meta.url);
        const bytes = statSync(portrait).size;
        assert.ok(bytes > 40_000, `${key}.webp must contain production portrait art`);
        assert.ok(bytes < 150 * 1024, `${key}.webp must remain below the 150 KiB portrait ceiling`);
    }
    const stormglassBanner = new URL("../assets/towers/stormglass-citadel.webp", import.meta.url);
    const bannerBytes = statSync(stormglassBanner).size;
    assert.ok(bannerBytes > 100_000, "the Stormglass chapter banner must contain production landscape art");
    assert.ok(bannerBytes < 512 * 1024, "the Stormglass chapter banner must remain below the 512 KiB landscape ceiling");
    const expectedStoryArt = [
        ["foothold", "footholdArt"],
        ["crossfire-glade", "crossfireGladeArt"],
        ["frozen-gauntlet", "frozenGauntletArt"],
        ["hold-the-line", "holdTheLineArt"],
        ["spire-warden", "spireWardenArt"],
        ["acolyte-coven", "acolyteCovenArt"],
        ["hollow-revenant", "hollowRevenantArt"],
        ["escort-vanguard", "escortVanguardArt"],
        ["pit-of-embers", "pitOfEmbersArt"],
        ["spire-sovereign", "spireSovereignArt"],
        ["stormglass-breach", "stormglassBreachArt"],
        ["thunder-archive", "thunderArchiveArt"],
        ["thousand-bolt-bridge", "thousandBoltBridgeArt"],
        ["broken-reflections", "brokenReflectionsArt"],
        ["stormglass-crown", "stormglassCrownArt"],
    ] as const;
    const authoredKeys = [...floorCatalog.matchAll(/\bartKey:\s*'([^']+)'/g)].map(match => match[1]);
    assert.deepEqual([...new Set(authoredKeys)].sort(), expectedStoryArt.map(([key]) => key).sort(), "every authored Story artKey must be bundled and resolved");
    for (const [artKey, binding] of expectedStoryArt) {
        assert.match(manifest, new RegExp(`"${artKey}":\\s*${binding}`));
        const floorArt = new URL(`../assets/towers/story/${artKey}.webp`, import.meta.url);
        const bytes = statSync(floorArt).size;
        assert.ok(bytes > 200_000, `${artKey}.webp must contain production floor art`);
        assert.ok(bytes < 512 * 1024, `${artKey}.webp must remain below the 512 KiB landscape ceiling`);
        const metadata = await sharp(readFileSync(floorArt)).metadata();
        assert.equal(metadata.format, "webp", `${artKey} must ship as WebP`);
        assert.deepEqual([metadata.width, metadata.height], [1536, 1024], `${artKey} must preserve the certified 3:2 crop`);
    }
    assert.match(manifest, /TOWER_STORY_FLOOR_ART\[normalized\]/);
    assert.match(manifest, /kind: "fallback", src: TOWER_KEY_ART, thumb: TOWER_KEY_ART_THUMB, key: null/);
    assert.match(manifest, /chapter === 2[\s\S]{0,100}?src: stormglassCitadel/);
    assert.match(lobby, /resolveTowerStoryArt\(floor\.artKey\)/);
    assert.match(lobby, /resolveTowerStoryChapterArt\(chapter\.number, chapter\.artKey\)/);
    assert.match(lobby, /data-art-fallback=/);
    assert.match(manifest, /kind: "unknown", src: null, \.\.\.UNKNOWN_TOWER_COMBATANT/);
    assert.match(fight, /if \(a\.side === "enemy"\)[\s\S]*?resolveTowerCombatantArt/, "enemy art must resolve by visual id before sealed avatar fallbacks");
    assert.match(fight, /tower-unknown-combatant-badge/);
    assert.match(lobby, /TOWER_KEY_ART/);
});

test("the Story floor list paints from icon-sized thumbnails, not the landscape masters", async () => {
    // The lobby lists every catalog floor at once in a 44x44 icon. Sourcing those
    // from the 1536x1024 masters cost ~4.3 MB of transfer and ~94 MB of decoded
    // bitmaps before the screen could respond, which froze the tab on entry.
    const authoredKeys = [...new Set([...floorCatalog.matchAll(/\bartKey:\s*'([^']+)'/g)].map(match => match[1]))];
    let thumbBytes = 0;
    for (const artKey of [...authoredKeys, "key-art", "stormglass-citadel"]) {
        const thumb = new URL(`../assets/towers/thumbs/${artKey}.webp`, import.meta.url);
        const bytes = statSync(thumb).size;
        assert.ok(bytes < 24 * 1024, `${artKey} thumbnail must stay under the 24 KiB icon ceiling (got ${bytes})`);
        thumbBytes += bytes;
        const metadata = await sharp(readFileSync(thumb)).metadata();
        assert.equal(metadata.format, "webp", `${artKey} thumbnail must ship as WebP`);
        assert.deepEqual([metadata.width, metadata.height], [240, 160], `${artKey} thumbnail must keep the 240x160 icon crop`);
    }
    // Whole icon strip must stay cheaper than a single master.
    assert.ok(thumbBytes < 200 * 1024, `the Tower icon strip must stay under 200 KiB in total (got ${thumbBytes})`);
    // Every authored master needs a matching thumbnail binding, or the resolver
    // silently falls back to the master and the regression returns.
    for (const artKey of authoredKeys) {
        assert.match(manifest, new RegExp(`"${artKey}":\\s*\\w+Thumb`), `${artKey} must be bound in TOWER_STORY_FLOOR_THUMB`);
    }
    assert.match(manifest, /thumb: TOWER_STORY_FLOOR_THUMB\[normalized\] \?\? src/);
    assert.match(manifest, /kind: "fallback", src: TOWER_KEY_ART, thumb: TOWER_KEY_ART_THUMB/);
    // The floor card renders the thumbnail; the masters stay on the full-bleed surfaces.
    assert.match(lobby, /<img src=\{floorArt\.thumb\}/, "the floor-card icon must render the thumbnail, never the master");
    assert.doesNotMatch(lobby, /<img src=\{floorArt\.src\}/, "the floor-card icon must not fall back to the landscape master");
});

test("the selected Story encounter promotes its authored art with safe accessibility fallbacks", () => {
    assert.match(lobby, /const selectedFloorArt = selFloor \? resolveTowerStoryArt\(selFloor\.artKey\) : null/);
    assert.match(lobby, /className="tower-floor-briefing-hero"\s*aria-hidden="true"/);
    assert.match(lobby, /--tower-floor-briefing-art/);
    assert.match(lobby, /data-art-fallback=\{selectedFloorArt\?\.kind === "fallback"/);
    assert.match(lobbyCss, /\.tower-floor-briefing-hero\s*\{[\s\S]{0,500}?var\(--tower-floor-briefing-art\)/);
    assert.match(lobbyCss, /@media \(prefers-reduced-data: reduce\)[\s\S]{0,180}?\.tower-floor-briefing-hero[\s\S]{0,100}?background-image:\s*none/);
    assert.match(lobbyCss, /@media \(forced-colors: active\)[\s\S]{0,1000}?\.tower-floor-briefing-hero\s*\{\s*background-image:\s*none/);
});
