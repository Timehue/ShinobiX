import assert from "node:assert/strict";
import { test } from "node:test";
import { CHRONICLE_STORY_SOURCES } from "../../../shared/story-card-sources";
import { storyBossEligibility, storyBossEnemyTemplate } from "../../../api/story/_authoritative-story-combat";
import { applyStoryBossSettlement, STORY_LEVELS, STORY_REWARDS } from "../../../api/story/_settle";
import { applyAcademyNarrativeAction } from "../../../api/player/_academy-narrative";
import { VILLAGE_OUTSKIRTS } from "../../../shared/sector-geo";
import { academyCeremony, academyStoryMomentFor } from "../lib/academy-narrative";
import { departureNarrative } from "../lib/departure-narrative";
import { storyRewardSummary } from "../lib/story-result-presentation";
import { storyToCreatorEvent } from "../lib/story-trigger";
import type { Character } from "../types/character";
import { storylines } from "./storylines";

// Cross the authoring/server boundary: checking two client catalogs alone did
// not catch a stale shared name reaching the sealed enemy and Chronicle card.
for (const [village, chapters] of Object.entries(storylines)) {
    test(`${village}: every chapter launches the advertised opponent and reports its actual reward`, () => {
        assert.deepEqual(chapters.map(chapter => chapter.levelReq), [...STORY_LEVELS]);
        for (const [index, chapter] of chapters.entries()) {
            const label = `${village} chapter ${index + 1}`;
            const profile = storyBossEnemyTemplate({ village, progressIndex: index });
            const source = CHRONICLE_STORY_SOURCES.find(entry => entry.village === village && entry.levelReq === chapter.levelReq);
            assert.equal(profile.name, chapter.bossName, label);
            assert.equal(source?.bossName, chapter.bossName, label);
            assert.equal(profile.id, chapter.aiProfileId, label);
            const event = storyToCreatorEvent(chapter, village, index);
            const battles = event.vnPages!.flatMap(page => page.choices ?? []).flatMap(choice => choice.battle ? [choice.battle] : []);
            assert.ok(battles.length > 0, label);
            for (const battle of battles) {
                assert.equal(battle.bossName, profile.name, label);
                assert.equal(battle.aiProfileId, profile.id, label);
            }

            const character = { name: "Audit", village, level: chapter.levelReq, storyProgress: index,
                hp: 100, maxHp: 100, stamina: 100, maxStamina: 100, chakra: 100, maxChakra: 100,
                ryo: 300, auraDust: 7, unspentStats: 0, inventory: [], starterCardsClaimed: true };
            assert.equal(storyBossEligibility(character).ok, true, label);
            assert.equal(storyBossEligibility({ ...character, level: chapter.levelReq - 1 }).ok, false, label);
            const result = applyStoryBossSettlement(character, { opponentId: profile.id }, 40);
            assert.equal(result.ok, true, label);
            if (!result.ok) continue;
            assert.equal(result.ryo, chapter.rewardRyo, label);
            assert.equal(result.character.ryo, 300 + result.ryo, label);
            assert.equal(result.statPoints, STORY_REWARDS[index].statPoints, label);
            assert.equal(result.character.unspentStats, result.statPoints, label);
            assert.equal(result.xp, 0, `${label}: retired XP is not presented as a reward`);
            assert.equal(result.character.auraDust, 7 + result.auraDust, label);
            assert.equal(storyRewardSummary(result), `+${result.statPoints.toLocaleString()} stat points · +${result.ryo.toLocaleString()} ryo · +${result.auraDust} Aura Dust`, label);
            assert.deepEqual(result.chronicleCards, [`story-${profile.id}`], label);
            assert.equal(result.progress, index + 1, label);
            assert.equal(applyStoryBossSettlement(result.character, { opponentId: profile.id }, 40).ok, false, `${label}: replay cannot pay again`);
            if (chapter.kageFinale) {
                assert.equal(result.title, chapter.liberatorTitle, label);
                assert.ok((result.character.inventory as string[]).includes("hollow-gate-key"), label);
            }
        }
    });

    test(`${village}: the shared Academy handoffs work with its field location and ceremony`, () => {
        let character: Record<string, unknown> = { name: "Audit", village, level: 2,
            onboardingStep: "cafeteria", academySparClaimed: true, academyTrialClaimed: true,
            hp: 100, maxHp: 100, elements: ["Fire"] };
        const sector = VILLAGE_OUTSKIRTS[village];
        assert.ok(sector > 0);
        const apply = (action: "incident" | "logbook" | "trace" | "seal" | "complete") => {
            const result = applyAcademyNarrativeAction(character, { currentSector: sector }, action, action === "trace" ? sector : undefined);
            assert.equal(result.ok, true, `${village}: ${action}`);
            if (result.ok) character = result.character;
        };
        apply("incident");
        apply("logbook");
        assert.equal(academyStoryMomentFor({ step: "sectorReturn", screen: "worldMap", currentSector: sector, incidentSeen: true, sectorVisited: false }), "fieldTrace");
        apply("trace");
        assert.equal(academyStoryMomentFor({ step: "sectorReturn", screen: "village", currentSector: 0, incidentSeen: true, sectorVisited: true }), "returnCeremony");
        assert.notEqual(academyCeremony(village).rite, "First Field-Return Rite");
        apply("seal");
        apply("complete");
        assert.equal(character.onboardingStep, "done");
        assert.equal(character.academyFieldSeal, true);
        assert.equal(departureNarrative({ character: character as unknown as Character, screen: "village", nextScreen: "centralHub", triggeredEvents: [], creatorEvents: [] }), null,
            "an awakened graduate must not receive another first-element summons");
    });
}
