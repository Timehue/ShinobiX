import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COMBAT_IMAGE_CATEGORIES } from "./image-category-hydration";
import { URL_MODE_CATEGORIES } from "./shared-image-cache";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// The corpus this gate speaks for: the three surfaces that render a live fight,
// plus every helper they hand `sharedImages` to. A fight's art is only partly
// looked up inline — the enemy portrait, battlefield sprite, tower combatant and
// companion orb all resolve inside these modules.
const FIGHT_SOURCES = [
    "../screens/MissionArenaFight.tsx",
    "../screens/BattleTowerFight.tsx",
    "../screens/PvpBattleScreen.tsx",
    "./battlefield-actor-art.ts",
    "./ai-fight-art.ts",
    "./tower-art-manifest.ts",
    "./pet-battle-anim.ts",
    "./own-avatar.ts",
] as const;

// Bucket prefix -> the image CATEGORY that hydrates it, mirroring
// KNOWN_PREFIXES in api/images.ts. The pet battle-art slots all ride 'pet'.
const CATEGORY_FOR_PREFIX: Record<string, string> = {
    jutsu: "jutsu", item: "item", ai: "ai", card: "card", bloodline: "bloodline",
    event: "event", vn: "event", shrine: "shrine", landmark: "landmark",
    avatar: "avatar", leader: "leader",
    pet: "pet", petbody: "pet", petsheet: "pet", petlayers: "pet",
};

// Hydrated elsewhere, so a fight never has to ask:
//  - avatar: warmed at login by App's own effect.
//  - event/vn: the dungeon Warden portrait is resolved from the DUNGEON screen
//    and passed into the fight as a fixed `enemyAvatar` string, so hydrating it
//    mid-fight could not change what that fight shows anyway.
const HYDRATED_ELSEWHERE = new Set(["avatar", "event"]);

/**
 * Every shared-image bucket a source names, in any quote style and any shape:
 * a direct subscript (`sharedImages['jutsu:' + id]`), a template key
 * (`` shared[`ai:${visual}`] ``), a helper argument (`variantImageKeys("pet:", …)`)
 * or a named constant (`const PET_BODY_PREFIX = "petbody:"`). Matching every
 * `"<word>:"` literal rather than one call shape is deliberate: the caller only
 * counts a match that is a known image prefix, so the worst a stray literal or a
 * comment can do is demand that a bucket be hydratable, which is the safe
 * direction. The narrow version of this scan matched backticks only and so
 * passed vacuously for all of PvpBattleScreen, which quotes its keys.
 */
function sharedImageBuckets(source: string): Set<string> {
    const found = new Set<string>();
    for (const [, prefix] of source.matchAll(/[`'"]([a-z]+):/g)) found.add(prefix);
    return found;
}

test("a fight can hydrate every shared-image bucket it renders", () => {
    const loadable = new Set<string>(COMBAT_IMAGE_CATEGORIES);
    const unhydrated: string[] = [];
    let scanned = 0;
    for (const path of FIGHT_SOURCES) {
        for (const prefix of sharedImageBuckets(read(path))) {
            const category = CATEGORY_FOR_PREFIX[prefix];
            if (!category) continue; // not an image bucket (e.g. a plain array index)
            scanned++;
            if (loadable.has(category) || HYDRATED_ELSEWHERE.has(category)) continue;
            unhydrated.push(`${path} reads sharedImages['${prefix}:…'] (category '${category}')`);
        }
    }
    assert.deepEqual(
        unhydrated,
        [],
        "A fight is a body portal, so the screen -> category map cannot reach it. " +
            "Add the missing category to COMBAT_IMAGE_CATEGORIES.",
    );
    // Guard against a silent no-op: prove the scan still sees the real buckets.
    // PvpBattleScreen uses single quotes and MissionArenaFight uses backticks —
    // an earlier version of this regex matched only backticks and passed
    // vacuously for the whole PvP file.
    assert.ok(scanned >= 8, `the bucket scan only found ${scanned} buckets; it has stopped matching real code`);
    const mission = sharedImageBuckets(read("../screens/MissionArenaFight.tsx"));
    for (const expected of ["jutsu", "item", "ai"]) {
        assert.ok(mission.has(expected), `the scan stopped matching '${expected}:' in MissionArenaFight`);
    }
    const pvp = sharedImageBuckets(read("../screens/PvpBattleScreen.tsx"));
    for (const expected of ["jutsu", "item", "avatar"]) {
        assert.ok(pvp.has(expected), `the scan stopped matching single-quoted '${expected}:' in PvpBattleScreen`);
    }
    assert.ok(sharedImageBuckets(read("./pet-battle-anim.ts")).has("petbody"), "the scan stopped seeing the pet battle-art slots");
});

test("the combat buckets stay URL-mode so opening a fight costs manifests, not base64", () => {
    for (const category of COMBAT_IMAGE_CATEGORIES) {
        assert.ok(
            URL_MODE_CATEGORIES.has(category),
            `'${category}' is not URL-mode, so hydrating it on every fight would pull full image payloads`,
        );
    }
});

test("App hydrates image categories through the hook, not a screen-only effect", () => {
    const app = read("../App.tsx");
    assert.match(
        app,
        /useImageCategoryHydration\(loadScreenImageCategories, loadCategory, screen, activeTriggeredEvent\)/,
        "App must route image-category hydration through the hook that also watches the fight cover",
    );
    assert.doesNotMatch(
        app,
        /useEffect\(\(\) => \{ loadScreenImageCategories\(screen\); \}, \[screen\]\)/,
        "the screen-only effect is back; a body-portaled fight would stop hydrating its own art",
    );
});

test("the fight hosts stay outside any screen branch, which is why hydration is not screen-keyed", () => {
    // If these ever become screen-gated, the screen -> category map could carry
    // the combat buckets and this module's reason for existing needs re-checking.
    for (const line of read("../App.tsx").split("\n")) {
        for (const host of ["<StoryBossFightHost", "<AiFightHost"]) {
            if (!line.includes(host)) continue;
            assert.doesNotMatch(
                line,
                /screen === /,
                `${host} is now screen-gated — re-check COMBAT_IMAGE_CATEGORIES against the screen map`,
            );
        }
    }
});

test("the cost chip never shares a corner with Details or the cooldown pip", () => {
    const css = read("../styles/battle-skin.css");
    // Measured with a real server-stamped cooldown: the pip covered 37% of the
    // chip at 1440 and 39% at 1024, leaving "25 C".
    assert.match(
        css,
        /#combat \.combat-jutsu-card-wrap:has\(> \.combat-cd-badge\) \.combat-jutsu-resources\s*\{[^}]*right: 28px !important;/s,
        "the wide tier must step the cost chip inside the cooldown pip",
    );
    assert.match(
        css,
        /@container shinobi-combat \(min-width: 980px\)\s*\{[\s\S]*?\.combat-jutsu-card-wrap:has\(> \.combat-cd-badge\) \.combat-jutsu-resources\s*\{[^}]*right: 27px !important;/s,
        "the 980-1179 tier must step the cost chip inside the cooldown pip too",
    );
});
