import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORY_KAGE_ENCOUNTERS } from '../../shared/story-kage.js';
import { validateBossTransformationPlan } from '../../shared/boss-transformations.js';
import { aiStatsForLevel } from '../_ai-level-curves.js';
import { maxChakraForLevel, maxStaminaForLevel } from '../_xp-engine.js';
import { hexNeighbors } from '../combat-core/grid.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { STANDARD_PVE_AI_POLICY } from '../solo-pve/_ai-turn-policy.js';
import { applySoloPveAction } from '../solo-pve/_engine.js';
import type { SoloPveJutsu, SoloPveSession } from '../solo-pve/_session.js';
import { STORY_LEVELS } from './_settle.js';
import { createStoryCombatBinding, storyBossEnemyTemplate, validateCompletedStoryCombatSession } from './_authoritative-story-combat.js';
import { STORY_KAGE_TRANSFORMATIONS } from './_kage-transformations.js';

const NOW = 1_800_000_000_000;
const FINAL_INDEX = STORY_LEVELS.length - 1;
const VILLAGES = Object.keys(STORY_KAGE_ENCOUNTERS);

function character(village: string) {
    return {
        name: 'Hero', village, level: 100, storyProgress: FINAL_INDEX,
        hp: 10_000, maxHp: 10_000, chakra: maxChakraForLevel(100), maxChakra: maxChakraForLevel(100),
        stamina: maxStaminaForLevel(100), maxStamina: maxStaminaForLevel(100),
        specialty: 'Ninjutsu', stats: aiStatsForLevel(100), jutsuMastery: [],
        ryo: 100, auraDust: 0, unspentStats: 0, inventory: [], equipment: {},
    };
}

function encounter(village: string, runId = `kage-form-${village}`): SoloPveSession {
    const binding = createStoryCombatBinding({ runId, playerName: 'hero', village, progressIndex: FINAL_INDEX, now: NOW });
    return buildSoloPveAiEncounter({
        sessionId: runId, playerName: 'hero', save: { character: character(village) },
        profile: storyBossEnemyTemplate({ village, progressIndex: FINAL_INDEX }), now: NOW,
        admin: null, difficultyMode: 'STORY', aiTurnPolicy: STANDARD_PVE_AI_POLICY, env: {},
        encounter: { kind: 'story-boss', id: `${village}:${FINAL_INDEX}`, sourceId: binding.opponentId, bindingId: runId },
    });
}

/** Stand next to the Kage so a basic attack always lands. */
function adjacent(session: SoloPveSession): SoloPveSession {
    session.enemy.pos = hexNeighbors(session.player.pos)[0]!;
    return session;
}

const kitIds = (session: SoloPveSession) => (session.enemy.character.jutsu as SoloPveJutsu[]).map(jutsu => jutsu.id);
/** A save/load cycle: what a refresh does to the stored session. */
const reload = (session: SoloPveSession): SoloPveSession => JSON.parse(JSON.stringify(session)) as SoloPveSession;

test('every final Kage seals one half-health transformation that heals a quarter', () => {
    for (const village of VILLAGES) {
        const plan = STORY_KAGE_TRANSFORMATIONS[village as keyof typeof STORY_KAGE_TRANSFORMATIONS];
        assert.deepEqual(validateBossTransformationPlan(plan), [], village);
        assert.equal(plan.phases.length, 1);
        assert.equal(plan.phases[0]!.atHpPct, 50);
        assert.equal(plan.phases[0]!.healPct, 25);
        const session = encounter(village);
        assert.ok(session.bossForms, `${village}: the plan is sealed into the session`);
        assert.equal(session.bossForms!.phase, 0);
        assert.deepEqual(Object.keys(session.bossFormKit!.jutsu).sort(), [...plan.phases[0]!.moveset!.add!].sort());
        for (const id of plan.phases[0]!.moveset!.remove!) assert.ok(kitIds(session).includes(id), `${village}: ${id} is in the opening kit`);
    }
});

test('crossing half health transforms the Kage inside the same battle, once', () => {
    for (const village of VILLAGES) {
        const plan = STORY_KAGE_TRANSFORMATIONS[village as keyof typeof STORY_KAGE_TRANSFORMATIONS];
        const form = plan.phases[0]!;
        const session = adjacent(encounter(village));
        const playerBefore = { hp: session.player.hp, chakra: session.player.chakra, stamina: session.player.stamina, statuses: structuredClone(session.player.statuses) };
        session.enemy.hp = Math.floor(session.enemy.maxHp / 2) + 1;
        const hpBeforeHit = session.enemy.hp;
        const hit = applySoloPveAction(session, { type: 'basicAttack' });
        assert.ok(hit.applied, hit.reason ?? 'rejected');
        const after = hit.session;
        assert.equal(after.status, 'active');
        assert.equal(after.sessionId, session.sessionId, 'the same battle instance');
        assert.equal(after.bossForms!.phase, 1);
        assert.deepEqual(after.bossForms!.triggered, [form.id]);
        const dealt = hpBeforeHit - (after.enemy.hp - Math.floor(after.enemy.maxHp / 4));
        assert.ok(dealt > 0, `${village}: the hit landed before the heal`);
        assert.equal(after.bossForms!.last!.healed, Math.floor(after.enemy.maxHp / 4), `${village}: regains 25% of max HP`);
        assert.equal(after.enemy.character.avatarImage, form.portrait, 'alternate artwork');
        for (const id of form.moveset!.remove!) assert.ok(!kitIds(after).includes(id), `${village}: drops ${id}`);
        for (const id of form.moveset!.add!) assert.ok(kitIds(after).includes(id), `${village}: learns ${id}`);
        assert.equal(kitIds(after).length, kitIds(session).length, 'a swap, not a bigger kit');
        const mastery = after.enemy.character.jutsuMastery as Array<{ jutsuId: string }>;
        assert.deepEqual(mastery.map(entry => entry.jutsuId), kitIds(after), 'every technique keeps mastery');
        const rules = after.enemy.character.aiRules as Array<{ jutsuId?: string; action: string }>;
        assert.equal(rules[0]?.jutsuId, form.moveset!.favor![0], 'the favoured signature leads the AI program');
        assert.ok(after.log.some(line => line.includes(form.formName)), 'the battle log announces the form');
        // The player's resources and active effects are untouched by the transformation itself.
        assert.equal(after.player.chakra, playerBefore.chakra);
        assert.deepEqual(after.player.statuses, playerBefore.statuses);

        // Refresh, then keep hitting below half: no second transformation or heal.
        const reloaded = adjacent(reload(after));
        reloaded.enemy.hp = Math.floor(reloaded.enemy.maxHp / 3);
        const again = applySoloPveAction(reloaded, { type: 'basicAttack' }).session;
        assert.equal(again.bossForms!.seq, 1, `${village}: one transformation in total`);
        assert.ok(again.enemy.hp < Math.floor(reloaded.enemy.maxHp / 3), 'no second heal');
    }
});

test('a blow that would finish the Kage before it transforms is caught at 1 HP, and the next one wins', () => {
    const village = 'Stormveil Village';
    const session = adjacent(encounter(village, 'kage-lethal'));
    session.enemy.hp = 1;
    const saved = applySoloPveAction(session, { type: 'basicAttack' }).session;
    assert.equal(saved.status, 'active', 'the transformation is never skipped');
    assert.equal(saved.bossForms!.last!.savedFromLethal, true);
    assert.equal(saved.enemy.hp, 1 + Math.floor(saved.enemy.maxHp / 4));

    const finish = adjacent(reload(saved));
    finish.enemy.hp = 1;
    finish.enemy.shield = 0;
    finish.ap.player = 100;
    const win = applySoloPveAction(finish, { type: 'basicAttack' }).session;
    assert.equal(win.status, 'done');
    assert.equal(win.winner, 'player', 'victory handling is unchanged once the form is spent');
    const binding = createStoryCombatBinding({ runId: win.sessionId, playerName: 'hero', village, progressIndex: FINAL_INDEX, now: NOW });
    assert.equal(validateCompletedStoryCombatSession({ binding, session: win, playerName: 'hero', character: character(village), now: NOW + 1 }).ok, true);
});

test('every form hits harder and pays for it: more damage taken or health burned each turn', async () => {
    const { soloPveBossFormMultiplier } = await import('../solo-pve/_boss-forms.js');
    for (const village of VILLAGES) {
        const form = STORY_KAGE_TRANSFORMATIONS[village as keyof typeof STORY_KAGE_TRANSFORMATIONS].phases[0]!;
        const session = adjacent(encounter(village, `kage-cost-${village}`));
        assert.equal(soloPveBossFormMultiplier(session, 'enemy'), 1, 'no form power before the transformation');
        session.enemy.hp = Math.floor(session.enemy.maxHp / 2);
        const formed = applySoloPveAction(session, { type: 'basicAttack' }).session;
        assert.equal(formed.bossForms!.phase, 1);
        assert.ok(soloPveBossFormMultiplier(formed, 'enemy') >= 1, `${village}: never weaker`);
        const power = (s: SoloPveSession) => (s.enemy.character.jutsu as SoloPveJutsu[]).reduce((sum, j) => sum + Number(j.effectPower ?? 0), 0);
        assert.ok(power(formed) > power(session), `${village}: the form's techniques are stronger`);
        assert.equal(soloPveBossFormMultiplier(formed, 'player', { element: 'Fire', type: 'Ninjutsu' }), form.damageTakenMult ?? 1);
        const burns = form.mechanic?.kind === 'limit-burn' || (form.upkeepPct ?? 0) > 0;
        assert.ok(burns, `${village}: holding the form costs health every turn`);
    }
});

test('Thunder God Shroud charges a bolt on its turn and releases it next turn unless broken', () => {
    const transform = (runId: string) => {
        const session = adjacent(encounter('Stormveil Village', runId));
        session.enemy.hp = Math.floor(session.enemy.maxHp / 2);
        const formed = applySoloPveAction(session, { type: 'basicAttack' }).session;
        assert.equal(formed.bossForms!.phase, 1);
        return formed;
    };
    // Unanswered: the Kage waits one round after transforming, arms the bolt on
    // its next turn, and releases it on the turn after that.
    const chargeOf = (s: SoloPveSession) => s.bossForms?.charge;
    const unanswered = transform('kage-charge');
    let state = applySoloPveAction(unanswered, { type: 'wait' }).session;
    assert.equal(chargeOf(state), undefined, 'no charge on the turn it transformed');
    state = applySoloPveAction(state, { type: 'wait' }).session;
    const armed = chargeOf(state);
    assert.ok(armed, 'the charge is armed on the boss turn');
    assert.ok(state.log.some(line => line.includes('begins gathering Heaven-Splitting Bolt')));
    const armedRound = armed.armedRound;
    state = applySoloPveAction(state, { type: 'wait' }).session;
    assert.equal(chargeOf(state), undefined);
    assert.ok(state.log.some(line => line.includes('releases Heaven-Splitting Bolt')), 'it detonates on the next boss turn');
    assert.ok(state.round > armedRound);

    // Answered: deal the break threshold during the player's turn.
    const answered = applySoloPveAction(applySoloPveAction(transform('kage-break'), { type: 'wait' }).session, { type: 'wait' }).session;
    const charge = answered.bossForms!.charge!;
    assert.ok(charge);
    const ready = adjacent(reload(answered));
    ready.enemy.hp = charge.hpAtArm - charge.breakAt + 1;
    ready.enemy.shield = 0;
    const broke = applySoloPveAction(ready, { type: 'basicAttack' }).session;
    assert.equal(broke.bossForms!.charge, undefined, 'the charge is broken');
    assert.ok(broke.log.some(line => line.includes('Heaven-Splitting Bolt is broken')));
    assert.ok((broke.bossForms!.staggeredUntilRound ?? 0) >= broke.round, 'the Kage is staggered');
});

test('Oath-Gate Release burns the Kage every turn without ever killing him', () => {
    const session = adjacent(encounter('Frostfang Village', 'kage-gates'));
    session.enemy.hp = Math.floor(session.enemy.maxHp / 2);
    const formed = applySoloPveAction(session, { type: 'basicAttack' }).session;
    const hpAfterForm = formed.enemy.hp;
    const next = applySoloPveAction(formed, { type: 'wait' }).session;
    assert.ok(next.log.some(line => line.startsWith('Burning Seals costs')), 'the release burns at the end of his turn');
    assert.ok(next.enemy.hp < hpAfterForm);
    const nearlyGone = reload(next);
    nearlyGone.enemy.hp = 2;
    nearlyGone.player.hp = nearlyGone.player.maxHp;
    const after = applySoloPveAction(nearlyGone, { type: 'wait' }).session;
    assert.ok(after.enemy.hp >= 1 || after.winner === 'player', 'the burn alone never defeats him');
    if (after.status === 'done') assert.notEqual(after.winner, 'enemy');
});

test('only the story finale transforms: same opponent id in another mode, and earlier story bosses, do not', () => {
    const village = 'Stormveil Village';
    const finale = storyBossEnemyTemplate({ village, progressIndex: FINAL_INDEX });
    assert.equal('bossTransformation' in finale, false, 'the authored template itself is unchanged');
    const asRaidGuard = buildSoloPveAiEncounter({
        sessionId: 'raid-guard', playerName: 'hero', save: { character: character(village) }, profile: finale, now: NOW,
        admin: null, difficultyMode: 'STORY', aiTurnPolicy: STANDARD_PVE_AI_POLICY, env: {},
        encounter: { kind: 'village-war-garrison', id: 'guard', sourceId: finale.id },
    });
    assert.equal(asRaidGuard.bossForms, undefined);
    const earlier = storyBossEnemyTemplate({ village, progressIndex: FINAL_INDEX - 1 });
    const binding = createStoryCombatBinding({ runId: 'earlier', playerName: 'hero', village, progressIndex: FINAL_INDEX - 1, now: NOW });
    const earlierFight = buildSoloPveAiEncounter({
        sessionId: 'earlier', playerName: 'hero', save: { character: { ...character(village), storyProgress: FINAL_INDEX - 1 } }, profile: earlier, now: NOW,
        admin: null, difficultyMode: 'STORY', aiTurnPolicy: STANDARD_PVE_AI_POLICY, env: {},
        encounter: { kind: 'story-boss', id: `${village}:${FINAL_INDEX - 1}`, sourceId: binding.opponentId, bindingId: 'earlier' },
    });
    assert.equal(earlierFight.bossForms, undefined);
});
