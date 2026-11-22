import assert from 'node:assert/strict';
import test from 'node:test';
import badges from '../../shared/coast-quest-badges.json';
import { achievementRewardForIds, eligibleAchievementIds } from '../achievements/_catalog.js';
import { COAST_TALE_LINES } from './_coast-tales.js';
import { QUEST_LINE_CATALOGUE } from './_catalog.js';
import { claimQuestLine, questLineViews, type QuestEngineDeps } from './_engine.js';
import { emptyQuestLines, parseQuestLines } from './_record.js';

const deps: QuestEngineDeps = {
    catalogue: QUEST_LINE_CATALOGUE, buildingPlace: () => null, ryo: () => 0,
    tileDistance: () => 0, grantStatPoints: character => character,
};
const ctx = { now: 100, clan: { generation: 'landing', tenured: true } };
const quests = ['shuttered-boat', 'crossing-war-5', 'the-unmoored', 'boatwright-tools-3', 'uncounted-3', 'clan-gate-3', 'untamed-coast-3'];
const matchingIds = ['crossing', 'crossing-war', 'finale', 'boatwright', 'uncounted', 'clan-gate', 'untamed', 'tales'].map(key => 'coast-' + key + '-v1');

test('each coast quest badge belongs to its claim and uses the ordinary achievement reward', () => {
    assert.deepEqual(badges.map(badge => badge.id).sort(), [...matchingIds].sort());
    for (const [index, id] of quests.entries()) {
        const expected = matchingIds[index];
        for (const ending of id === 'the-unmoored' ? ['open', 'closed'] : ['']) {
            const record = emptyQuestLines();
            record.active[id] = { at: 1, stage: deps.catalogue.lines[id].stages.length, choices: { ask: ending } };
            const paid = claimQuestLine(deps, record, { level: 100, inventory: [] }, id, ctx);
            assert.equal(paid.ok, true, id);
            assert.deepEqual(paid.character?.coastBadges, [expected]);
            assert.deepEqual(eligibleAchievementIds(paid.character!).filter(key => matchingIds.includes(key)), [expected]);
            assert.deepEqual(achievementRewardForIds([expected]), { ryo: 2000, fateShards: 0 });
            assert.equal(claimQuestLine(deps, paid.record!, paid.character!, id, ctx).body?.replayed, true);
        }
    }
});

test('whichever of the ten side tales finishes last earns the set once and displays it on that tale', () => {
    const tales = Object.keys(COAST_TALE_LINES);
    assert.equal(tales.length, 10);
    const badge = 'coast-tales-v1';
    for (const last of tales) {
        const record = emptyQuestLines();
        record.done['unrelated-quest'] = { at: 1, marks: 0 };
        const others = tales.filter(id => id !== last);
        for (const id of others.slice(0, -1)) record.done[id] = { at: 1, marks: 0 };
        record.active[last] = { at: 2, stage: deps.catalogue.lines[last].stages.length };
        assert.equal(claimQuestLine(deps, record, {}, last, ctx).character?.coastBadges, undefined);
        record.done[others.at(-1)!] = { at: 3, marks: 0 };
        const paid = claimQuestLine(deps, record, {}, last, ctx);
        assert.deepEqual(paid.character?.coastBadges, [badge]);
        const loaded = parseQuestLines(paid.record);
        const views = questLineViews(deps, loaded, { level: 100, inClan: true }).lines;
        assert.deepEqual(views.filter(view => view.rewardArtKeys?.includes(badge)).map(view => view.id), [last]);
        assert.equal(claimQuestLine(deps, loaded, paid.character!, last, ctx).body?.replayed, true);
    }
});
