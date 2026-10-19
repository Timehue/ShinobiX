import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PvpFighter } from '../../../api/pvp/session.js';
import { createSoloPveSession, soloPveSessionForResponse, type SoloPveSession } from '../../../api/solo-pve/_session.js';
import { hollowGateShinobiRoundLimit } from '../../../shared/hollow-gate-round-limit.js';
import { applySoloPveAction, endSoloPveTurn } from '../../../api/solo-pve/_engine.js';
import { hollowGateSessionDirective, sealHollowGateTelegraph } from '../../../shared/hollow-gate-telegraph.js';
import { hollowGateHazardDamage } from '../../../shared/hollow-gate-combat-director.js';
import { soloPveSessionForArena } from './solo-pve-arena-adapter';
import { mergeSoloBattleDebug, soloBattleDebugText } from './solo-battle-debug';
import { appendSoloPveCombatEvent } from '../../../api/solo-pve/_legacy-totals.js';

function fighter(name: string, pos: number): PvpFighter {
    return { name, pos, hp: 10000, maxHp: 10000, chakra: 500, maxChakra: 500,
        stamina: 500, maxStamina: 500, shield: 0, statuses: [],
        character: { name, level: 100, specialty: 'Taijutsu', stats: { strength: 1000, taijutsuOffense: 1200 }, jutsu: [], pvpItems: [], equipment: {} } };
}
function boss(round = 18, hp = 17100): SoloPveSession {
    const s = createSoloPveSession({ sessionId: 'offline-warden', ownerSlug: 'runner',
        encounter: { kind: 'hollow-gate', id: 'boss', metadata: { floor: 3, combatKind: 'boss' } },
        player: fighter('Runner', 26), enemy: { ...fighter('Mirror-Shard Warden', 27), hp, maxHp: 24360 }, now: 1800000000000 });
    s.round = round; s.ap.player = 40; sealHollowGateTelegraph(s); return s;
}
function contiguous(s: SoloPveSession) { assert.deepEqual(s.events.map(e => e.seq), Array.from({ length: s.eventSeq }, (_, i) => i + 1)); }

for (const kind of ['battle', 'elite', 'ambush', 'beast', 'boss']) test(`${kind} shinobi encounter continues past 25 and loses only after unresolved round 40`, () => {
    const s = boss(25); s.encounter.metadata!.combatKind = kind; s.hollowGateRoundLimit = 25;
    s.activeSide = 'enemy'; sealHollowGateTelegraph(s); endSoloPveTurn(s);
    assert.equal(s.round, 26); assert.equal(s.status, 'active'); assert.equal(s.hollowGateRoundLimit, 40);
    s.round = 40; s.activeSide = 'enemy'; sealHollowGateTelegraph(s); endSoloPveTurn(s);
    assert.equal(s.round, 41); assert.equal(s.outcome, 'loss'); assert.equal(s.terminalReason, 'round-limit');
    const lastHit = boss(40, 1); lastHit.encounter.metadata!.combatKind = kind;
    const won = applySoloPveAction(lastHit, { type: 'basicAttack' }).session;
    assert.equal(won.outcome, 'win'); assert.equal(won.round, 40); assert.equal(won.terminalReason, 'knockout');
});

test('active legacy resume projects 40 without mutating the stored compare-set predecessor', () => {
    const raw = boss(25); raw.hollowGateRoundLimit = 25; const before = structuredClone(raw);
    const projected = soloPveSessionForResponse(raw);
    assert.equal(projected.hollowGateRoundLimit, 40); assert.equal(projected.version, raw.version);
    assert.deepEqual(raw, before);
    assert.equal(soloPveSessionForArena(raw as never).hollowGateRoundLimit, 40);
    raw.ap.player = 100;
    const moved = applySoloPveAction(raw, { type: 'wait' }).session;
    assert.equal(moved.status, 'active'); assert.equal(moved.round, 26); assert.equal(moved.hollowGateRoundLimit, 40);
});

test('already terminal 25-round fights stay terminal and keep their historical cap', () => {
    const old = boss(26); old.hollowGateRoundLimit = 25; old.status = 'done'; old.outcome = 'loss'; old.winner = 'enemy'; old.terminalReason = 'round-limit';
    assert.equal(soloPveSessionForResponse(old), old);
    assert.equal(soloPveSessionForArena(old as never).hollowGateRoundLimit, 25);
    assert.equal(hollowGateShinobiRoundLimit(old), 25);
    const rejected = applySoloPveAction(old, { type: 'basicAttack' });
    assert.equal(rejected.applied, false); assert.equal(rejected.session.status, 'done'); assert.equal(rejected.session.hollowGateRoundLimit, 25);
});

test('other Solo-PvE hosts retain 25; PvP, card and pet runtimes cannot select the shrine cap', () => {
    for (const kind of ['generic-ai', 'weekly-boss', 'world-ai', 'mission', 'tower']) {
        const s = boss(25); s.encounter.kind = kind; delete s.hollowGateRoundLimit; s.activeSide = 'enemy';
        assert.equal(hollowGateShinobiRoundLimit(s), undefined);
        endSoloPveTurn(s); assert.equal(s.status, 'done'); assert.equal(s.terminalReason, 'round-limit');
    }
    for (const runtime of ['pvp', 'pet-colosseum', 'card-clash', 'hunt-battle'])
        assert.equal(hollowGateShinobiRoundLimit({ runtime, encounter: { kind: 'hollow-gate' }, status: 'active' }), undefined);
});

test('last-AP threshold hit resolves the advertised safe pattern, then publishes the next phase', () => {
    const s = boss(), shown = hollowGateSessionDirective(s)!;
    assert.equal(shown.phase, 1); assert.ok(shown.safeTiles.includes(s.player.pos));
    assert.equal(hollowGateHazardDamage(shown, s.player.pos, s.player.maxHp), 0);
    const result = applySoloPveAction(s, { type: 'basicAttack' });
    assert.equal(result.applied, true); const n = result.session;
    assert.ok(n.enemy.hp <= n.enemy.maxHp * .7);
    assert.equal(n.round, 19); assert.equal(n.hollowGateTelegraph?.directive.phase, 2);
    assert.ok(!n.events.flatMap(e => e.log).some(line => /marked seal/.test(line)), 'no new phase-II pulse may ambush the old safe tile');
    assert.deepEqual(n.events.filter(e => e.kind === 'system').map(e => e.round), [18, 18]);
    contiguous(n);
});

test('remaining AP and JSON reconnect retain the same cue across either HP threshold', () => {
    for (const hp of [17100, 8600]) {
        const s = boss(18, hp); s.ap.player = 100;
        const shown = structuredClone(s.hollowGateTelegraph);
        const hit = applySoloPveAction(s, { type: 'basicAttack' }).session;
        assert.equal(hit.round, 18); assert.deepEqual(hit.hollowGateTelegraph, shown);
        const restored = JSON.parse(JSON.stringify(hit)) as SoloPveSession;
        assert.deepEqual(hollowGateSessionDirective(restored), shown!.directive);
        assert.deepEqual(soloPveSessionForArena(restored as never).hollowGateTelegraph, shown);
    }
});

test('healing above a phase threshold only changes the next decision; permanence is unchanged', () => {
    const s = boss(18, 16800), shown = hollowGateSessionDirective(s)!;
    assert.equal(shown.phase, 2); s.enemy.hp = 19000; s.activeSide = 'enemy';
    assert.deepEqual(hollowGateSessionDirective(s), shown);
    const hp = s.player.hp; endSoloPveTurn(s);
    assert.equal(hp - s.player.hp, hollowGateHazardDamage(shown, 26, 10000));
    assert.equal(hollowGateSessionDirective(s)!.phase, 1);
});

test('legacy boss fallback matches the first-action seal and named cue uses the actual opponent', () => {
    const s = boss(18); delete s.hollowGateTelegraph;
    const displayed = hollowGateSessionDirective(s)!; assert.match(displayed.instruction, /Mirror-Shard Warden/);
    s.ap.player = 100;
    const n = applySoloPveAction(s, { type: 'basicAttack' }).session;
    assert.deepEqual(n.hollowGateTelegraph?.directive, displayed);
});

test('ordinary fourth-floor pursuit remains sensitive to legal movement', () => {
    const s = boss(); s.encounter.metadata!.combatKind = 'battle'; s.encounter.metadata!.floor = 4;
    assert.equal(hollowGateSessionDirective(s)!.incomingDamageMultiplier, .9);
    s.player.pos = 119;
    assert.equal(hollowGateSessionDirective(s)!.incomingDamageMultiplier, 1.22);
});

for (const action of ['wait', 'flee'] as const) test(`${action} is recorded before end-turn resolution without duplicate hazards`, () => {
    const s = boss(18, 16000); s.ap.player = 100;
    const n = applySoloPveAction(s, { type: action }, { escapeSucceeds: () => false }).session;
    assert.equal(n.events[0].action, action); contiguous(n);
    assert.equal(n.events.flatMap(e => e.log).filter(line => /marked seal/.test(line)).length, 1);
    assert.equal(n.events.filter(e => e.kind === 'system').length, 2);
});

test('hazard KO exports the actual arena damage and does not reuse the previous action FX', () => {
    const s = boss(18, 16000); s.player.hp = 40; s.activeSide = 'enemy';
    s.fx = [{ target: 'player', kind: 'damage', amount: 444 }] as never;
    endSoloPveTurn(s); assert.equal(s.terminalReason, 'knockout'); assert.equal(s.player.hp, 0);
    assert.equal(s.hollowGateTelegraph?.round, 18, 'no next-player cue after KO');
    const view = soloPveSessionForArena(s as never);
    assert.ok(!JSON.stringify(view.beats).includes('444'));
    const journal = mergeSoloBattleDebug(undefined, s as never, 1);
    assert.match(soloBattleDebugText(journal), /Rift-Hunt Pounce.*800 damage/);
    assert.match(soloBattleDebugText(journal), /knockout/);
    assert.equal(journal.complete, true);
});

test('round 40 remains a loss with positive HP, with reason and full terminal log in reconnect export', () => {
    const s = boss(40); s.activeSide = 'enemy'; const hp = s.player.hp;
    endSoloPveTurn(s);
    assert.equal(s.round, 41); assert.equal(s.outcome, 'loss'); assert.equal(s.terminalReason, 'round-limit'); assert.equal(s.player.hp, hp);
    const restored = JSON.parse(JSON.stringify(s));
    const journal = mergeSoloBattleDebug(undefined, restored, 1);
    assert.match(soloBattleDebugText(journal), /Round limit reached/);
    assert.match(soloBattleDebugText(journal), /round-limit/); assert.match(soloBattleDebugText(journal), /Round limit: 40/); assert.equal(journal.complete, true);
    const finalHit = boss(40, 1); finalHit.player.pos = 26;
    const won = applySoloPveAction(finalHit, { type: 'basicAttack' }).session;
    assert.equal(won.outcome, 'win'); assert.equal(won.terminalReason, 'knockout');
    assert.ok(!won.events.flatMap(e => e.log).some(line => /Round limit/.test(line)));
});

for (const round of [18, 40]) test(`DoT KO on round ${round} ends resolution before a hazard, cap loss or next-player cue`, () => {
    const s = boss(round, 16000); s.enemy.hp = 40; s.activeSide = 'enemy';
    s.enemy.statuses = [{ name: 'Wound', amount: 100, rounds: 2, activeRound: 1, kind: 'negative' }];
    endSoloPveTurn(s);
    assert.equal(s.outcome, 'win'); assert.equal(s.terminalReason, 'knockout');
    assert.equal(s.round, round); assert.equal(s.hollowGateTelegraph?.round, round);
    assert.ok(!s.events.flatMap(e => e.log).some(line => /marked seal/.test(line)));
    assert.ok(s.events[0].log.some(line => /Wound/.test(line)));
});

test('AP exhaustion, companion actions and the enemy turn resolve a marked pulse exactly once', () => {
    const s = boss(18, 16000);
    s.companion = { ...fighter('Companion', 28), hp: 100, maxHp: 100, petId: 'offline-pet', baseDamage: 10,
        happiness: 100, loyal: true, moves: [], cooldowns: {}, roundsLeft: 3, pveGearId: 'none' };
    const n = applySoloPveAction(s, { type: 'basicAttack' }).session;
    contiguous(n); assert.equal(n.round, 19);
    assert.ok(n.events.some(e => e.actor === 'companion'));
    assert.equal(n.events.flatMap(e => e.log).filter(line => /marked seal/.test(line)).length, 1);
});

test('bounded shrine history survives reconnect past 80 events; other hosts retain the existing window', () => {
    for (const kind of ['hollow-gate', 'generic-ai'] as const) {
        const s = boss(25); s.activeSide = 'enemy'; endSoloPveTurn(s);
        const seed = s.events[0]; s.encounter.kind = kind; s.events = []; s.eventSeq = 0; delete s.legacyTotals;
        for (let seq = 1; seq <= 150; seq++) appendSoloPveCombatEvent(s, { ...seed, seq });
        assert.equal(s.events.length, kind === 'hollow-gate' ? 150 : 80);
        assert.equal(s.legacyTotals?.damageDealt, 0, 'arena facts never award duplicate legacy credit');
    }
});
