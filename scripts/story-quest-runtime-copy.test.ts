import assert from "node:assert/strict";
import { test } from "node:test";
import { builtinAiProfile } from "../api/_ai-profile-catalog";
import { buildSoloPveAiEncounter } from "../api/solo-pve/_ai-encounter";
import { applyWorldAiFightSettlement, buildWorldAiFightSpec, worldContextWinProofCount } from "../api/missions/_world-ai-fight";
import { QUEST_BOOK as SERVER_QUESTS } from "../api/sector/_questbook";
import { WANDERER_QUESTS } from "../api/sector/_wanderer-quest";
import { STORY_RECKONINGS } from "../api/sector/_story-reckoning";
import { RIFT_QUESTS } from "../api/sector/_rift-quest";
import { storyRoadEvents } from "../shinobij.client/src/data/story-road-events";
import { storyReckonings } from "../shinobij.client/src/data/story-reckonings";
import { hollowRifts } from "../shinobij.client/src/data/hollow-rifts";
import { roadEventToCreatorEvent } from "../shinobij.client/src/lib/story-road-events";
import { creatorEventPracticeOpponent } from "../shinobij.client/src/lib/creator-event-practice";
import { QUEST_BOOK, questbookStageText } from "../shinobij.client/src/lib/questbook";
import { WANDERER_QUEST_CATALOG } from "../shinobij.client/src/lib/wanderers";
import { EMISSARY_DEFS } from "../shinobij.client/src/lib/legacy-emissaries";
import { STORY_ROAD_FIGHTS } from "../shared/story-road-fights";
import { narrativeGroupFor } from '../shared/narrative-groups';

test("every named road fight reaches the sealed enemy under its authored identity", () => {
    const used = new Set<string>();
    let battles = 0;
    for (const road of storyRoadEvents) {
        const event = roadEventToCreatorEvent(road, "forest");
        for (const page of event.vnPages ?? []) for (const choice of page.choices ?? []) {
            if (!choice.battle) continue;
            const selected = creatorEventPracticeOpponent(event.aiProfileId, choice.battle.aiProfileId, road.levelReq);
            assert.equal(selected.authored, true, `${road.id}: no generic fallback`);
            const profile = builtinAiProfile(selected.id);
            assert.ok(profile, `${road.id}: published server profile`);
            assert.equal(profile.name, choice.battle.bossName);
            const session = buildSoloPveAiEncounter({ sessionId: `audit-${++battles}`, playerName: "audit", now: 1_700_000_000_000,
                admin: null, profile, save: { character: { name: "Audit", level: road.levelReq, hp: 100, maxHp: 100,
                    chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, stats: {}, inventory: [] } } });
            const group = narrativeGroupFor(profile.id);
            if (group) {
                assert.equal(session.huntCombat!.battle.encounterFloor!.name, choice.battle.bossName);
                assert.deepEqual(session.huntCombat!.battle.actors.filter(a => a.side === 'enemy').map(a => a.name), group.members.map(m => m.name));
            } else assert.equal(session.enemy.name, choice.battle.bossName);
            used.add(selected.id);
        }
    }
    assert.equal(battles, 10);
    assert.deepEqual([...used].sort(), STORY_ROAD_FIGHTS.map(profile => profile.id).sort());
});

test("epic objectives name the required quest fight on both sides, including pursuit branches", () => {
    assert.deepEqual(Object.keys(QUEST_BOOK).sort(), Object.keys(SERVER_QUESTS).sort());
    for (const [id, quest] of Object.entries(QUEST_BOOK)) {
        assert.deepEqual(quest.stages, SERVER_QUESTS[id].stages, id);
        for (const stage of quest.stages) {
            if (stage.metric !== "totalAiKills" || !stage.bossId) continue;
            assert.match(stage.text, /this quest's Fight button/, `${id}/${stage.key}`);
            assert.doesNotMatch(stage.text, /other AI victories also count|Win \d+ AI battles?/, `${id}/${stage.key}`);
        }
    }
    const stage = QUEST_BOOK["qb-defector"].stages[1];
    for (const offer of ["trust", "turnin"]) assert.match(questbookStageText(stage, { offer }), /Shirakawa and both members of the erasure team using this quest's Fight button/);
});

test("the caravan epic's three wins require three fresh, matching quest-fight receipts", async () => {
    const sealed = { id: "qb-caravan", stage: 1, baseline: 10, at: 1234, choices: {} };
    const spec = await buildWorldAiFightSpec({ playerName: "Audit", request: { kind: "questbook-boss", sourceId: sealed.id, sector: 25 },
        save: { currentSector: 25, activeQuestbookSeal: sealed, character: { name: "Audit", level: 25 } } });
    assert.equal(spec.context.displayName, 'Goro’s Challenge — Wave 1: Vanguard');
    const expected = { kind: "questbook-boss" as const, sourceId: sealed.id, stage: 1, sealVersion: spec.context.sealVersion! };
    let character: Record<string, unknown> = { name: "Audit", level: 25, totalAiKills: 100 };
    assert.equal(worldContextWinProofCount(character, expected), 0, "unrelated AI wins do not complete the named objective");
    character = applyWorldAiFightSettlement(character, spec.context, "loss", "lost-fight");
    assert.equal(worldContextWinProofCount(character, expected), 0);
    for (let win = 1; win <= 3; win++) {
        const next = await buildWorldAiFightSpec({ playerName: "Audit", request: { kind: "questbook-boss", sourceId: sealed.id, sector: 25 },
            save: { currentSector: 25, activeQuestbookSeal: sealed, character } });
        assert.equal(next.context.displayName, ['Goro’s Challenge — Wave 1: Vanguard', 'Goro’s Challenge — Wave 2: Flankers', 'Goro’s Challenge — Wave 3: Captain'][win - 1]);
        character = applyWorldAiFightSettlement(character, next.context, "win", `goro-${win}`);
        assert.equal(worldContextWinProofCount(character, expected), win);
        assert.deepEqual(applyWorldAiFightSettlement(character, spec.context, "win", `goro-${win}`), character, "replays cannot add a win");
    }
    assert.equal(worldContextWinProofCount(character, { ...expected, sealVersion: "previous-acceptance" }), 0);
});

test("all wandering and emissary errand labels use the server's metric and target", () => {
    const quests = [...WANDERER_QUEST_CATALOG, ...EMISSARY_DEFS.flatMap(emissary => emissary.quests)];
    assert.deepEqual(quests.map(quest => quest.id).sort(), Object.keys(WANDERER_QUESTS).sort());
    for (const quest of quests) {
        assert.equal(quest.metric, WANDERER_QUESTS[quest.id].metric, quest.id);
        assert.equal(quest.target, WANDERER_QUESTS[quest.id].target, quest.id);
    }
});

test("personal recovery and hunt quests preserve server-owned gates, proof items and rewards", () => {
    assert.deepEqual(storyReckonings.map(quest => quest.id).sort(), Object.keys(STORY_RECKONINGS).sort());
    for (const quest of storyReckonings) {
        const server = STORY_RECKONINGS[quest.id];
        for (const key of ["village", "levelReq", "ownProgress", "completionTrait"] as const) assert.equal(quest[key], server[key], `${quest.id}/${key}`);
        for (const key of ["metric", "target", "dropItemId"] as const) assert.equal(quest.task[key], server[key], `${quest.id}/${key}`);
        assert.equal(quest.reward.weight, server.weight);
        assert.equal(quest.reward.fateShards ?? 0, server.fateShards);
        assert.equal(quest.reward.title, server.title);
    }
});

test("rift dialogue names the boss, floor count and reward actually sealed by the server", () => {
    assert.deepEqual(hollowRifts.map(rift => rift.id).sort(), Object.keys(RIFT_QUESTS).sort());
    for (const rift of hollowRifts) {
        const server = RIFT_QUESTS[rift.id];
        for (const key of ["levelReq", "floors", "bossAiId", "bossName"] as const) assert.equal(rift[key], server[key], `${rift.id}/${key}`);
        for (const key of ["weight", "fateShards", "boneCharms"] as const) assert.equal(rift.reward[key] ?? 0, server[key], `${rift.id}/${key}`);
    }
});
