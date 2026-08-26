import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DAILY_HUNT_LIMIT,
    DAILY_MISSION_LIMIT,
    STARTING_STAT_POINTS,
} from "../constants/game";
import {
    ROOKIE_STAT_PEAK_MULTIPLIER,
    ROOKIE_TAPER_END_LEVEL,
    TRAINING_TIERS,
} from "../lib/training-config";
import { BATTLE_FLOOR_FEE, BATTLE_FREE_FLOORS } from "../../../api/towers/_entry-fee";
import {
    CHRONICLE_ELEMENT_BATTLE_BONUS,
    MAIN_DECK_SIZE,
    OPENING_HAND_SIZE,
    STARTING_LIFE_POINTS,
} from "../../../shared/chronicle-duel";
import { HOLLOW_GATE_DEPTH } from "../../../shared/hollow-gate-contract";
import { NAMED_FORGE_COST, NAMED_FORGE_CURRENCY_POINTS } from "../../../shared/named-forge-economy";
import {
    SHOWDOWN_BENCH_SIZE,
    SHOWDOWN_TURN_CAP,
} from "../../../shared/pet-showdown-contract";
import { MAX_WILD_SECTOR } from "../../../shared/sector-geo";
import { GUIDE_CATEGORIES, GUIDES } from "./guides";

function textForGuide(id: string): string {
    const guide = GUIDES.find((candidate) => candidate.id === id);
    assert.ok(guide, `missing guide ${id}`);
    const parts = [guide.title, guide.tagline, guide.blurb, guide.audience, ...guide.quickTake];

    for (const section of guide.sections) {
        parts.push(section.heading);
        for (const block of section.blocks) {
            switch (block.type) {
                case "p":
                case "h":
                    parts.push(block.text);
                    break;
                case "list":
                    parts.push(...block.items);
                    break;
                case "table":
                    parts.push(block.caption, ...block.head, ...block.rows.flat());
                    break;
                case "callout":
                    parts.push(block.label, block.text);
                    break;
                case "figure":
                    parts.push(block.alt, block.caption);
                    break;
            }
        }
    }

    return parts.join(" ");
}

function numberText(value: number): string {
    return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][value]
        ?? value.toLocaleString("en-US");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("guide catalog has stable unique ids and complete editorial metadata", () => {
    assert.ok(GUIDES.length >= 10, "the field archive should cover the major live systems");
    assert.equal(new Set(GUIDES.map((guide) => guide.id)).size, GUIDES.length, "guide ids must be unique");
    assert.equal(GUIDES.filter((guide) => guide.featured).length, 1, "exactly one guide should lead the archive");

    for (const guide of GUIDES) {
        assert.ok(GUIDE_CATEGORIES.includes(guide.category), `${guide.id} has an unknown category`);
        assert.match(guide.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        assert.ok(guide.title.length >= 8);
        assert.ok(guide.tagline.length >= 24);
        assert.ok(guide.blurb.length >= 32);
        assert.ok(guide.hero.length > 0);
        assert.ok(guide.heroAlt.length >= 20);
        assert.ok(guide.readMinutes >= 3);
        assert.match(guide.reviewedAt, /^[A-Z][a-z]+ 20\d{2}$/);
        assert.equal(guide.quickTake.length, 3);
        assert.ok(guide.sections.length >= 4);

        const sectionIds = guide.sections.map((section) => section.id);
        assert.equal(new Set(sectionIds).size, sectionIds.length, `${guide.id} section ids must be unique`);
        for (const section of guide.sections) {
            assert.match(section.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
            assert.ok(section.heading.length >= 8);
            assert.ok(section.blocks.length > 0);
            for (const block of section.blocks) {
                if (block.type === "table") {
                    assert.ok(block.caption.length >= 8);
                    assert.ok(block.head.length >= 2);
                    for (const row of block.rows) {
                        assert.equal(row.length, block.head.length, `${guide.id}/${section.id} table row width drifted`);
                    }
                }
                if (block.type === "figure") {
                    assert.ok(block.src.length > 0);
                    assert.ok(block.alt.length >= 20);
                    assert.ok(block.caption.length >= 20);
                }
            }
        }
    }
});

test("every guide category is represented", () => {
    for (const category of GUIDE_CATEGORIES) {
        assert.ok(GUIDES.some((guide) => guide.category === category), `${category} has no guide`);
    }
});

test("player guides exclude retired routes, implementation notes, and exploration spoilers", () => {
    const copy = GUIDES.map((guide) => textForGuide(guide.id)).join(" ");

    assert.doesNotMatch(copy, /server[- ]sealed|server[- ]resolved|claim seal|compatibility path/i);
    assert.doesNotMatch(copy, /client[- ]authoritative|server[- ]authoritative|live code|API endpoint|implementation detail/i);
    assert.doesNotMatch(copy, /retired Tile Seal|old auto-battle|old guide|anti-abuse|anti-cheat/i);
    assert.doesNotMatch(copy, /25\s*[×x]\s*17|hidden chambers?/i);
});

test("high-drift guide numbers stay aligned with current game constants", () => {
    const firstHour = textForGuide("first-hour");
    const progression = textForGuide("progression");
    const world = textForGuide("world");
    const builds = textForGuide("builds");
    const companions = textForGuide("companions");
    const chronicle = textForGuide("chronicle-showdown");
    const endgame = textForGuide("endgame");

    assert.match(firstHour, new RegExp(`${STARTING_STAT_POINTS.toLocaleString("en-US")} starting stat points`, "i"));
    assert.match(progression, new RegExp(`up to ${DAILY_MISSION_LIMIT.toLocaleString("en-US")} missions`, "i"));
    assert.match(
        progression,
        new RegExp(`begin with ${DAILY_HUNT_LIMIT.toLocaleString("en-US")} hunts per day.*up to ${(DAILY_HUNT_LIMIT + 5).toLocaleString("en-US")}`, "i"),
    );
    assert.match(progression, new RegExp(`${numberText(ROOKIE_STAT_PEAK_MULTIPLIER)} times.*level ${ROOKIE_TAPER_END_LEVEL}`, "i"));
    for (const tier of TRAINING_TIERS) {
        const gain = Math.round(tier.ratePerHour * (tier.ms / (60 * 60 * 1000)));
        assert.match(
            progression,
            new RegExp(`${escapeRegExp(tier.label)}\\s+\\+${gain}\\s+${tier.staminaCost}`, "i"),
        );
    }

    assert.match(world, new RegExp(`${MAX_WILD_SECTOR} ordinary sectors`, "i"));
    assert.match(endgame, new RegExp(`${numberText(HOLLOW_GATE_DEPTH)}-floor`, "i"));
    assert.match(
        endgame,
        new RegExp(`first ${numberText(BATTLE_FREE_FLOORS)} entries into uncleared floors.*${BATTLE_FLOOR_FEE.toLocaleString("en-US")} ryo`, "i"),
    );

    assert.match(chronicle, new RegExp(`exactly ${MAIN_DECK_SIZE} cards`, "i"));
    assert.match(chronicle, new RegExp(`open with ${numberText(OPENING_HAND_SIZE)}`, "i"));
    assert.match(chronicle, new RegExp(`${STARTING_LIFE_POINTS.toLocaleString("en-US")} Health`, "i"));
    assert.match(chronicle, new RegExp(`advantage adds ${CHRONICLE_ELEMENT_BATTLE_BONUS}`, "i"));

    assert.match(companions, new RegExp(`${numberText(SHOWDOWN_BENCH_SIZE)} reserves`, "i"));
    assert.match(companions, new RegExp(`round ${SHOWDOWN_TURN_CAP}`, "i"));

    assert.match(builds, new RegExp(`${NAMED_FORGE_COST.toLocaleString("en-US")} Forge Points`, "i"));
    assert.match(builds, new RegExp(`Bone Charms count for ${NAMED_FORGE_CURRENCY_POINTS.boneCharms}`, "i"));
    assert.match(builds, new RegExp(`Fate Shards ${NAMED_FORGE_CURRENCY_POINTS.fateShards}`, "i"));
    assert.match(builds, new RegExp(`Aura Stones ${NAMED_FORGE_CURRENCY_POINTS.auraStones}`, "i"));
    assert.match(builds, new RegExp(`Mythic Seals ${NAMED_FORGE_CURRENCY_POINTS.mythicSeals}`, "i"));
});

test("economy guidance distinguishes catalogs, currency transfers, and claimable bank interest", () => {
    const copy = `${textForGuide("builds")} ${textForGuide("professions-economy")}`;

    assert.match(copy, /Shop and Grand Marketplace for catalog purchases/i);
    assert.match(copy, /Direct player transfers send currency, not items/i);
    assert.match(copy, /Bank interest requires banked ryo and at least one Town Hall Bank upgrade/i);
    assert.match(copy, /must be collected manually/i);
});
