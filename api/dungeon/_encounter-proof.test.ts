import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    applyDungeonCardTerminal,
    applyDungeonPetTerminal,
    dungeonCardMatchId,
    dungeonCardWasWon,
    dungeonPetWasWon,
    resolveDungeonCardAuthority,
    resolveDungeonPetAuthority,
    resolveExactDungeonRun,
} from './_encounter-proof.js';

const RUN_TOKEN = 'dungeonrun0001';
const WARDEN_PROOF = 'wardenproof0001';

function wardenCharacter() {
    return {
        name: 'Kiri',
        activeDungeonRun: {
            token: RUN_TOKEN,
            startedAt: 1,
            entry: 'key',
            combatAuthorityVersion: 1,
            wardenDefeated: true,
            wardenProofId: WARDEN_PROOF,
        },
    };
}

function wonCardCharacter() {
    const character = wardenCharacter();
    const matchId = dungeonCardMatchId(character.name, RUN_TOKEN);
    const out = applyDungeonCardTerminal({ character, dungeonRunToken: RUN_TOKEN, matchId, outcome: 'player', now: 20 });
    assert.equal(out.ok, true);
    if (!out.ok) throw new Error('Card proof fixture failed.');
    return { character: out.character, matchId };
}

describe('Dungeon encounter proof authority', () => {
    it('derives one stable Card match id and resolves only the exact active run', () => {
        const character = wardenCharacter();
        const lower = dungeonCardMatchId('kiri', RUN_TOKEN);
        assert.equal(lower, dungeonCardMatchId(' KIRI ', RUN_TOKEN));
        assert.match(lower, /^[0-9a-f]{64}$/);
        assert.equal(resolveExactDungeonRun(character, RUN_TOKEN).activeRun, character.activeDungeonRun);
        assert.equal(resolveDungeonCardAuthority({ playerName: 'Kiri', character, dungeonRunToken: RUN_TOKEN }).matchId, lower);
        assert.throws(() => resolveDungeonCardAuthority({
            playerName: 'Other', character, dungeonRunToken: RUN_TOKEN,
        }), /player does not match/);
        assert.throws(() => resolveExactDungeonRun(character, 'replacedrun0001'), /active Dungeon run/);
        assert.throws(() => resolveExactDungeonRun({ ...character, activeDungeonRun: null }, RUN_TOKEN), /active Dungeon run/);
        assert.throws(() => resolveDungeonCardAuthority({
            playerName: 'Kiri',
            character: { name: 'Kiri', activeDungeonRun: { token: RUN_TOKEN } },
            dungeonRunToken: RUN_TOKEN,
        }), /Warden win/);
    });

    it('binds Card proof identity to the canonical save slug, not display punctuation', () => {
        const character = { ...wardenCharacter(), name: 'Tyler R.' };
        const authority = resolveDungeonCardAuthority({
            playerName: 'tylerr',
            character,
            dungeonRunToken: RUN_TOKEN,
        });
        assert.equal(authority.playerName, 'tylerr');
        assert.equal(authority.matchId, dungeonCardMatchId('Tyler R.', RUN_TOKEN));
        const applied = applyDungeonCardTerminal({
            character,
            dungeonRunToken: RUN_TOKEN,
            matchId: authority.matchId,
            outcome: 'player',
            now: 21,
        });
        assert.equal(applied.ok, true);
    });

    it('records Card losses without qualifying and replays only an identical terminal proof', () => {
        const character = wardenCharacter();
        const matchId = dungeonCardMatchId(character.name, RUN_TOKEN);
        const loss = applyDungeonCardTerminal({ character, dungeonRunToken: RUN_TOKEN, matchId, outcome: 'opponent', now: 20 });
        assert.equal(loss.ok, true);
        if (!loss.ok) return;
        assert.equal(loss.alreadyApplied, false);
        assert.equal(dungeonCardWasWon(loss.character.activeDungeonRun as Record<string, unknown>), false);

        const replay = applyDungeonCardTerminal({ character: loss.character, dungeonRunToken: RUN_TOKEN, matchId, outcome: 'opponent', now: 99 });
        assert.equal(replay.ok, true);
        if (!replay.ok) return;
        assert.equal(replay.alreadyApplied, true);
        assert.equal(replay.character, loss.character);

        const drift = applyDungeonCardTerminal({ character: loss.character, dungeonRunToken: RUN_TOKEN, matchId, outcome: 'player', now: 99 });
        assert.equal(drift.ok, false);
        if (!drift.ok) assert.match(drift.error, /conflicts/);
    });

    it('accepts only the run-bound Card win and seals it against replacement', () => {
        const character = wardenCharacter();
        const matchId = dungeonCardMatchId(character.name, RUN_TOKEN);
        const unrelated = applyDungeonCardTerminal({ character, dungeonRunToken: RUN_TOKEN, matchId: 'unrelatedproof0001', outcome: 'player' });
        assert.equal(unrelated.ok, false);

        const won = applyDungeonCardTerminal({ character, dungeonRunToken: RUN_TOKEN, matchId, outcome: 'player', now: 20 });
        assert.equal(won.ok, true);
        if (!won.ok) return;
        assert.equal(dungeonCardWasWon(won.character.activeDungeonRun as Record<string, unknown>), true);
        const active = won.character.activeDungeonRun as Record<string, unknown>;
        assert.equal(active.cardProofId, matchId);
        assert.equal(active.cardSettledAt, 20);

        const replaced = applyDungeonCardTerminal({
            character: { ...won.character, activeDungeonRun: { ...active, token: 'newdungeonrun01' } },
            dungeonRunToken: RUN_TOKEN,
            matchId,
            outcome: 'player',
        });
        assert.equal(replaced.ok, false);
    });

    it('requires the first two seals before Pet proof can be recorded', () => {
        assert.throws(() => resolveDungeonPetAuthority({ character: wardenCharacter(), dungeonRunToken: RUN_TOKEN }), /Card win/);
        const premature = applyDungeonPetTerminal({
            character: wardenCharacter(), dungeonRunToken: RUN_TOKEN,
            proofId: 'petproof0001', outcome: 'win', petIds: ['pet-1'], now: 30,
        });
        assert.equal(premature.ok, false);
        const wonCard = wonCardCharacter();
        assert.equal(resolveDungeonPetAuthority({ character: wonCard.character, dungeonRunToken: RUN_TOKEN }).dungeonRunToken, RUN_TOKEN);
    });

    it('records Pet loss/draw evidence but qualifies only an exact authoritative win', () => {
        const { character } = wonCardCharacter();
        const loss = applyDungeonPetTerminal({
            character, dungeonRunToken: RUN_TOKEN,
            proofId: 'petproof0001', outcome: 'loss', petIds: ['pet-1'], now: 30,
        });
        assert.equal(loss.ok, true);
        if (!loss.ok) return;
        assert.equal(dungeonPetWasWon(loss.character.activeDungeonRun as Record<string, unknown>), false);
        const replay = applyDungeonPetTerminal({
            character: loss.character, dungeonRunToken: RUN_TOKEN,
            proofId: 'petproof0001', outcome: 'loss', petIds: ['pet-1'], now: 99,
        });
        assert.equal(replay.ok, true);
        if (replay.ok) {
            assert.equal(replay.alreadyApplied, true);
            assert.equal(replay.character, loss.character);
        }
        for (const changed of [
            { outcome: 'win' as const, petIds: ['pet-1'] },
            { outcome: 'loss' as const, petIds: ['pet-2'] },
        ]) {
            const drift = applyDungeonPetTerminal({
                character: loss.character, dungeonRunToken: RUN_TOKEN,
                proofId: 'petproof0001', ...changed,
            });
            assert.equal(drift.ok, false);
        }

        const fresh = wonCardCharacter().character;
        const win = applyDungeonPetTerminal({
            character: fresh, dungeonRunToken: RUN_TOKEN,
            proofId: 'petproof0002', outcome: 'win', petIds: ['pet-1'], now: 40,
        });
        assert.equal(win.ok, true);
        if (!win.ok) return;
        assert.equal(dungeonPetWasWon(win.character.activeDungeonRun as Record<string, unknown>), true);
        assert.deepEqual((win.character.activeDungeonRun as Record<string, unknown>).petLastPetIds, ['pet-1']);
        const replacedRun = applyDungeonPetTerminal({
            character: { ...win.character, activeDungeonRun: null }, dungeonRunToken: RUN_TOKEN,
            proofId: 'petproof0002', outcome: 'win', petIds: ['pet-1'],
        });
        assert.equal(replacedRun.ok, false);
    });
});
