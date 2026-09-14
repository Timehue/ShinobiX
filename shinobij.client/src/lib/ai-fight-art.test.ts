import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { storyRoadEvents } from "../data/story-road-events";
import { hollowRifts } from "../data/hollow-rifts";
import {
    canonicalBeastPortraitId,
    resolveDungeonWardenPortrait,
    resolveTowerEnemyPortrait,
    storyRoadBattlePortrait,
    type TowerEnemySpriteKey,
} from "./ai-fight-art";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..", "..");

const towerSprites: Partial<Record<TowerEnemySpriteKey, string>> = {
    bandit: "sprite:bandit",
    archer: "sprite:archer",
    blocker: "sprite:blocker",
    brute: "sprite:brute",
    acolyte: "sprite:acolyte",
    warden: "sprite:warden",
    ravager: "sprite:ravager",
    genin: "sprite:genin",
    revenant: "sprite:revenant",
    sovereign: "sprite:sovereign",
    stormcaller: "sprite:stormcaller",
    "mirror-shogun": "sprite:mirror-shogun",
    "void-emperor": "sprite:void-emperor",
    "stormglass-lancer": "sprite:stormglass-lancer",
    "stormglass-marksman": "sprite:stormglass-marksman",
    "stormglass-bastion": "sprite:stormglass-bastion",
    "stormglass-weaver": "sprite:stormglass-weaver",
    "thunder-archivist": "sprite:thunder-archivist",
    "stormglass-regent": "sprite:stormglass-regent",
    "tower-scout": "sprite:tower-scout",
    "clan-boss-oni": "sprite:clan-boss-oni",
    "clan-boss-leviathan": "sprite:clan-boss-leviathan",
    "clan-boss-kage": "sprite:clan-boss-kage",
    "clan-boss-golem": "sprite:clan-boss-golem",
};

test("authoritative tower visuals always resolve the intended portrait source", () => {
    assert.equal(
        resolveTowerEnemyPortrait("bandit", towerSprites, { "ai:bandit": "published:bandit" }),
        "sprite:bandit",
        "existing tower visuals keep their bundled-first behavior",
    );
    assert.equal(
        resolveTowerEnemyPortrait("boss-hollow-gate-warden", towerSprites, { "ai:boss-hollow-gate-warden": "published:warden" }),
        "published:warden",
    );

    const hollowFallbacks = {
        battle: "sprite:genin",
        elite: "sprite:blocker",
        ambush: "sprite:brute",
        beast: "sprite:ravager",
    } as const;
    for (const [kind, expected] of Object.entries(hollowFallbacks)) {
        assert.equal(resolveTowerEnemyPortrait(`hollow-gate-${kind}-f12`, towerSprites), expected);
    }

    for (const id of hollowRifts.map((rift) => rift.bossAiId)) {
        const portrait = resolveTowerEnemyPortrait(id, towerSprites);
        assert.equal(portrait, `/portraits/${id}.webp`);
        assert.ok(existsSync(join(clientRoot, "public", portrait!.slice(1))), `${id} portrait is missing`);
    }

    for (const id of ["clan-boss-oni", "clan-boss-leviathan", "clan-boss-kage", "clan-boss-golem"] as const) {
        assert.equal(resolveTowerEnemyPortrait(id, towerSprites), `sprite:${id}`);
    }
    for (const id of ["stormcaller", "mirror-shogun", "void-emperor", "stormglass-lancer", "stormglass-marksman", "stormglass-bastion", "stormglass-weaver", "thunder-archivist", "stormglass-regent", "tower-scout"] as const) {
        assert.equal(resolveTowerEnemyPortrait(id, towerSprites), `sprite:${id}`);
    }
});

test("Endless Tower portrait ids unwrap without changing ordinary AI ids", () => {
    assert.equal(canonicalBeastPortraitId("apex-ai-ember-drake"), "apex-ai-ember-drake");
    assert.equal(canonicalBeastPortraitId("endless-apex-ai-ember-drake-w20"), "apex-ai-ember-drake");
    assert.equal(canonicalBeastPortraitId("endless-hunt-ai-frost-wolf-w7"), "hunt-ai-frost-wolf");
});

test("every authored Story Road battle has a real portrait file", () => {
    let battles = 0;
    for (const event of storyRoadEvents) {
        for (const page of event.pages) {
            for (const choice of page.choices ?? []) {
                if (!choice.battle) continue;
                battles++;
                const portrait = storyRoadBattlePortrait(choice.battle.bossName);
                assert.ok(portrait, `${choice.battle.bossName} has no combat portrait mapping`);
                assert.ok(existsSync(join(clientRoot, "public", portrait.slice(1))), `${portrait} is missing`);
            }
        }
    }
    assert.equal(battles, 10, "update the portrait audit when Story Road battles change");
});

test("dungeon Wardens use character art and never the scene backdrop", () => {
    const event = {
        id: "builtin-hidden-dungeon",
        avatarImage: "avatar:fallback",
        vnPages: [
            { title: "one", scene: "", speaker: "", dialogue: [], rightImage: "inline:first" },
            { title: "two", scene: "", speaker: "", dialogue: [], rightImage: "inline:last" },
        ],
    };
    assert.equal(resolveDungeonWardenPortrait(event, {
        "event:builtin-hidden-dungeon:warden": "published:dedicated",
        "vn:builtin-hidden-dungeon:page:1:right": "published:last",
    }), "published:dedicated");
    assert.equal(resolveDungeonWardenPortrait(event, {
        "vn:builtin-hidden-dungeon:page:1:right": "published:last",
    }), "published:last");
    assert.equal(resolveDungeonWardenPortrait(event, {
        "vn:builtin-hidden-dungeon:page:0:right": "published:first",
    }), "published:first", "published character art beats a later inline fallback");
    assert.equal(resolveDungeonWardenPortrait(event, {}), "inline:last");
    assert.equal(resolveDungeonWardenPortrait({ id: "plain", avatarImage: "avatar:only" }, {}), "avatar:only");
});

test("the image resolvers stay wired into both combat screens", () => {
    const app = readFileSync(join(clientRoot, "src", "App.tsx"), "utf8");
    const triggeredBattle = readFileSync(join(clientRoot, "src", "lib", "triggered-event-battle.ts"), "utf8");
    const towerFight = readFileSync(join(clientRoot, "src", "screens", "BattleTowerFight.tsx"), "utf8");
    const dungeonStart = app.slice(app.indexOf("async function startDungeonAiFight"), app.indexOf("function startAcademySparringMatch"));
    assert.match(dungeonStart, /await import\("\.\/lib\/ai-fight-art"\)/,
        "Dungeon-only portrait resolution must stay off the initial application graph");
    assert.match(dungeonStart, /characterRef\.current\?\.name !== owner/);
    assert.ok(dungeonStart.indexOf("characterRef.current?.name !== owner") < dungeonStart.indexOf("resolveDungeonWardenPortrait(event, sharedImages)"),
        "the deferred portrait load must remain account-fenced before launching with captured Dungeon art");
    assert.match(app, /launchTriggeredEventBattle\(\{/,
        "App must route triggered-event combat through the extracted sealed launcher");
    assert.match(triggeredBattle, /creatorEventPracticeOpponent\(event\.aiProfileId, battle\?\.aiProfileId/,
        "creator-road flavor fights must use the published profile whose sealed identity supplies combat art");
    assert.doesNotMatch(app, /image:\s*event\.avatarImage\s*\|\|\s*event\.image/);
    assert.match(towerFight, /resolveTowerCombatantArt\(visual, sharedImages\)\.src/);
    assert.match(towerFight, /TOWER_SPIRE_PORTRAITS\[spireMeta\.boss\.key\]/);
});
