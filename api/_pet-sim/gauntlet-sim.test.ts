import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    startGauntletRun,
    buyOffer,
    buyItem,
    buyRelic,
    rerollShop,
    fieldedPets,
    applyGauntletBuffs,
    enemySquadForRound,
    beginFight,
    applyRoundResult,
    boardModsFromRelics,
} from '../../shinobij.client/src/lib/pet-gauntlet.js';
import { applySynergiesToSquad } from '../../shinobij.client/src/lib/pet-synergies.js';
import { runPetGridBattle, BOARD_COLS } from '../../shinobij.client/src/lib/pet-board-sim.js';
import type { Pet } from '../../shinobij.client/src/types/pet.js';
import { replayGauntlet, type GauntletAction } from './gauntlet-sim.js';

/*
 * The reward-integrity property: the server RE-SIMULATES the run from the sealed
 * seed + the decision transcript and pays from THAT — a fabricated roundsCleared
 * can no longer be asserted.
 *
 * The gold test cross-checks the server replayGauntlet against a reconstruction
 * driven by the LIVE CLIENT engine (same seed + same actions + the same fight
 * wiring the PetGauntlet screen uses): the two must agree on the final
 * roundsCleared / heartsLeft / premium flags, proving the server port is faithful.
 */

// Client fight wiring — a verbatim mirror of components/PetGauntlet.tsx
// (fightSeed / enemyUnits / startRound), with accuracy:false (the client Gauntlet
// fight is pinned off so client + server agree deterministically).
const fightSeed = (run: { seed: number; round: number }) => (run.seed * 7919 + run.round * 104729) >>> 0;
function clientEnemyUnits(pets: Pet[]) {
    const rows: Pet[][] = [[], [], []];
    for (const pet of pets) {
        const r = pet.role ?? 'sage';
        rows[r === 'defender' ? 0 : r === 'assassin' || r === 'tracker' ? 2 : 1].push(pet);
    }
    const units: { pet: Pet; row: number; col: number }[] = [];
    rows.forEach((rowPets, row) => {
        const start = Math.max(0, Math.round((BOARD_COLS - rowPets.length) / 2));
        rowPets.forEach((pet, i) => units.push({ pet, row, col: Math.min(BOARD_COLS - 1, start + i) }));
    });
    return units;
}
type Place = { row: number; col: number };
function clientFightWon(run: ReturnType<typeof startGauntletRun>, place: Place[]): boolean {
    const squad = applySynergiesToSquad(applyGauntletBuffs(fieldedPets(run), run.buffs));
    const playerUnits = squad.map((pet, i) => ({ pet, row: place[i]?.row ?? 2, col: place[i]?.col ?? 0 }));
    const enemy = enemySquadForRound(run);
    const result = runPetGridBattle(playerUnits, clientEnemyUnits(enemy), fightSeed(run), { playerMods: boardModsFromRelics(run.relics), accuracy: false });
    return result.result === 'win';
}

// Drive the CLIENT engine with a transcript, mirroring replayGauntlet's dispatch.
function runClient(seed: number, actions: GauntletAction[]) {
    let run = startGauntletRun(seed);
    for (const a of actions) {
        if (run.status === 'won' || run.status === 'lost') break;
        switch (a.k) {
            case 'buy': run = buyOffer(run, a.i); break;
            case 'item': run = buyItem(run, a.id); break;
            case 'relic': run = buyRelic(run, a.id); break;
            case 'reroll': run = rerollShop(run); break;
            case 'fight': {
                const started = beginFight(run);
                if (started.status !== 'fighting') { run = started; break; }
                const won = clientFightWon(started, (a.place ?? []) as Place[]);
                run = applyRoundResult(started, won);
                break;
            }
            default: break;
        }
    }
    return { roundsCleared: run.roundsCleared, heartsLeft: run.hearts, boughtFateShard: run.boughtFateShard, boughtBoneCharm: run.boughtBoneCharm, status: run.status };
}

const P3: Place[] = [{ row: 0, col: 0 }, { row: 2, col: 1 }, { row: 1, col: 2 }, { row: 0, col: 3 }, { row: 2, col: 4 }];

// A rich scripted run: draft, reroll, item, relic, and several fights.
function scriptedActions(): GauntletAction[] {
    return [
        { k: 'buy', i: 0 }, { k: 'buy', i: 0 }, { k: 'buy', i: 0 },
        { k: 'fight', place: P3 },
        { k: 'reroll' }, { k: 'buy', i: 0 },
        { k: 'fight', place: P3 },
        { k: 'item', id: 'whetstone' }, { k: 'buy', i: 0 },
        { k: 'fight', place: P3 },
        { k: 'relic', id: 'razor_fang' }, { k: 'buy', i: 0 },
        { k: 'fight', place: P3 },
        { k: 'fight', place: P3 },
    ];
}

test('server replayGauntlet matches the live client run (roundsCleared / hearts / premium)', () => {
    for (const seed of [1, 42, 424242, 7777, 0x5f3759df]) {
        const actions = scriptedActions();
        const client = runClient(seed, actions);
        const server = replayGauntlet(seed, actions);
        assert.deepEqual(server, client, `seed ${seed}: server re-sim must equal the client run`);
    }
});

test('a fabricated transcript that never fields/wins pays 0 (fights are re-simulated)', () => {
    // Claim a deep run (12 fights) but field nothing → beginFight no-ops every time.
    const actions: GauntletAction[] = Array.from({ length: 12 }, () => ({ k: 'fight', place: [] as Place[] }));
    const r = replayGauntlet(31337, actions);
    assert.equal(r.roundsCleared, 0);
    assert.equal(r.boughtFateShard, false);
    assert.equal(r.boughtBoneCharm, false);
    assert.notEqual(r.status, 'won');
});

test('premium currency cannot be minted without a re-simulated round-9 clear', () => {
    // A weak run that claims a Fate Shard + Bone Charm buy — buyPremium requires
    // roundsCleared >= 9 in the re-sim, which this run never reaches, so both stay 0.
    const actions: GauntletAction[] = [
        { k: 'buy', i: 0 },
        { k: 'premium', kind: 'fateShard' },
        { k: 'premium', kind: 'boneCharm' },
        { k: 'fight', place: [{ row: 2, col: 0 }] },
        { k: 'premium', kind: 'fateShard' },
        { k: 'premium', kind: 'boneCharm' },
    ];
    const r = replayGauntlet(555, actions);
    assert.equal(r.boughtFateShard, false, 'Fate Shard never banks without a real round-9 clear');
    assert.equal(r.boughtBoneCharm, false, 'Bone Charm never banks without a real round-9 clear');
});

test('replay is robust to a malformed / non-array transcript', () => {
    assert.deepEqual(replayGauntlet(1, null), { roundsCleared: 0, heartsLeft: 3, boughtFateShard: false, boughtBoneCharm: false, status: 'drafting' });
    assert.equal(replayGauntlet(1, [{ k: 'bogus' } as unknown as GauntletAction, { k: 'buy', i: 999 }]).roundsCleared, 0);
});
