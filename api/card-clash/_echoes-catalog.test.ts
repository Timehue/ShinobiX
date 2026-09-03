import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    ECHOES_ENCOUNTERS,
    ECHOES_REWARDS,
    applyEchoesVictory,
    echoesEncounterById,
    echoesFloorUnlocked,
    echoesHighestUnlockedFloor,
    echoesProgressOf,
} from './_echoes-catalog.js';
import {
    CHRONICLE_AI_DIFFICULTIES,
    MAIN_DECK_SIZE,
    getChronicleCard,
    validateDeckIds,
} from '../../shared/chronicle-duel.js';

// Tests run from the repo root (scripts/run-tests.mjs), so cwd-relative is
// stable — and unlike import.meta, it also type-checks under the CommonJS
// cpanel build.
const CLIENT_PUBLIC = path.resolve(process.cwd(), 'shinobij.client', 'public');

type ClientScenePage = { title: string; scene: string; speaker: string; dialogue: string[] };
type ClientScenes = {
    preShowdown: ClientScenePage[]; defeat: ClientScenePage[];
    firstVictory: ClientScenePage[]; rematch: ClientScenePage[];
};
type ClientOpponent = {
    id: string; floor: number; name: string; title: string; deckName: string;
    deckTheme: string; difficultyLabel: string; isBoss?: true;
    shortDescription: string; lockedHint: string; portrait: string; sceneImage: string;
    chronicleNote: string;
};

async function loadClientData(): Promise<{
    ECHOES_OPPONENTS: readonly ClientOpponent[];
    ECHOES_REWARD_DISPLAY: Record<string, number>;
    ECHOES_SCENES: Readonly<Record<string, ClientScenes>>;
}> {
    // Computed specifiers on purpose: tsx resolves them at runtime, but tsc does
    // NOT pull the client modules into the cpanel compile (a literal import
    // makes tsc emit a stray dist/shinobij.client/ subtree). The scene script
    // lives in the build-time-only scenes module (shipped as on-demand JSON),
    // while the shell keeps the display metadata this test mirrors.
    const shellSpecifier = '../../shinobij.client/src/data/echoes-of-war.js';
    const scenesSpecifier = '../../shinobij.client/src/data/echoes-of-war-scenes.js';
    const shell = (await import(shellSpecifier)) as {
        ECHOES_OPPONENTS: readonly ClientOpponent[];
        ECHOES_REWARD_DISPLAY: Record<string, number>;
    };
    const scenes = (await import(scenesSpecifier)) as {
        ECHOES_SCENES: Readonly<Record<string, ClientScenes>>;
    };
    return { ...shell, ECHOES_SCENES: scenes.ECHOES_SCENES };
}

test('the campaign has ten encounters on floors 1 through 10 with unique ids', () => {
    assert.equal(ECHOES_ENCOUNTERS.length, 10);
    const floors = ECHOES_ENCOUNTERS.map((def) => def.floor).sort((a, b) => a - b);
    assert.deepEqual(floors, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(new Set(ECHOES_ENCOUNTERS.map((def) => def.id)).size, 10);
    for (const def of ECHOES_ENCOUNTERS) {
        assert.ok(CHRONICLE_AI_DIFFICULTIES.includes(def.difficulty), `${def.id} has a real AI difficulty`);
    }
});

test('every opponent deck is a legal 40-card Chronicle Showdown deck from the obtainable pool', () => {
    for (const def of ECHOES_ENCOUNTERS) {
        assert.equal(def.deck.length, MAIN_DECK_SIZE, `${def.id} runs exactly ${MAIN_DECK_SIZE} cards`);
        const verdict = validateDeckIds([...def.deck]);
        assert.equal(verdict.valid, true, `${def.id}: ${verdict.errors.join('; ')}`);
        for (const id of def.deck) {
            assert.ok(getChronicleCard(id), `${def.id} references a real card: ${id}`);
            assert.ok(
                !id.startsWith('story-') && !id.startsWith('legacy-') && !id.startsWith('pet-witness-'),
                `${def.id} avoids progression-unlock cards the player cannot pack (${id})`,
            );
        }
    }
});

test('difficulty and the boss ramp match the campaign plan', () => {
    for (const def of ECHOES_ENCOUNTERS) {
        const expected = def.floor <= 3 ? 'easy' : def.floor <= 6 ? 'medium' : 'hard';
        assert.equal(def.difficulty, expected, `${def.id} pilots at ${expected}`);
        assert.equal(!!def.isBoss, def.floor === 10, `only floor 10 is the chapter boss (${def.id})`);
    }
});

test('reward amounts match the handoff economy', () => {
    assert.equal(ECHOES_REWARDS.repeatWin, 15);
    assert.equal(ECHOES_REWARDS.firstClearBonus, 35);
    assert.equal(ECHOES_REWARDS.bossFirstClearBonus, 50);
    assert.equal(ECHOES_REWARDS.basicPackCost, 100);
});

test('floors unlock strictly in order from a fresh record', () => {
    const fresh = echoesProgressOf({});
    assert.equal(echoesFloorUnlocked(fresh, 1), true);
    for (let floor = 2; floor <= 10; floor += 1) assert.equal(echoesFloorUnlocked(fresh, floor), false);
    assert.equal(echoesFloorUnlocked(fresh, 0), false);
    assert.equal(echoesFloorUnlocked(fresh, 11), false);
    assert.equal(echoesHighestUnlockedFloor(fresh), 1);

    const clearedOne = { 'echoes-1-tovin': { wins: 1, firstClearAt: 5 } };
    assert.equal(echoesFloorUnlocked(clearedOne, 2), true);
    assert.equal(echoesFloorUnlocked(clearedOne, 3), false);
    assert.equal(echoesHighestUnlockedFloor(clearedOne), 2);

    // A gap never opens later floors: floor 4 cleared alone does not open 5.
    const gap = { 'echoes-4-ansel': { wins: 3, firstClearAt: 5 } };
    assert.equal(echoesFloorUnlocked(gap, 2), false);
    assert.equal(echoesFloorUnlocked(gap, 5), false);
    assert.equal(echoesHighestUnlockedFloor(gap), 1);
});

test('victory settlement pays 50 on a first clear, 15 on a repeat, and 100 on the boss first clear', () => {
    const tovin = echoesEncounterById('echoes-1-tovin')!;
    const first = applyEchoesVictory({ chroniclePoints: 0 }, tovin, 1000);
    assert.equal(first.summary.points, 50);
    assert.equal(first.summary.firstClear, true);
    assert.equal(first.summary.bossBonus, 0);
    assert.equal(first.summary.balance, 50);
    assert.equal(first.summary.unlockedFloor, 2);
    assert.equal((first.character.chroniclePoints as number), 50);

    const repeat = applyEchoesVictory(first.character, tovin, 2000);
    assert.equal(repeat.summary.points, 15);
    assert.equal(repeat.summary.firstClear, false);
    assert.equal(repeat.summary.balance, 65);
    assert.equal(repeat.summary.unlockedFloor, null);
    assert.equal(repeat.summary.wins, 2);
    // The first-clear stamp never moves on later wins.
    const record = echoesProgressOf(repeat.character);
    assert.equal(record['echoes-1-tovin']!.firstClearAt, 1000);

    const halden = echoesEncounterById('echoes-10-halden')!;
    const boss = applyEchoesVictory({ chroniclePoints: 7 }, halden, 3000);
    assert.equal(boss.summary.points, 100);
    assert.equal(boss.summary.bossBonus, 50);
    assert.equal(boss.summary.balance, 107);
    assert.equal(boss.summary.unlockedFloor, null, 'there is no floor 11');
});

test('a hostile stored record cannot mint progress or negative balances', () => {
    const parsed = echoesProgressOf({
        echoesOfWar: {
            'echoes-1-tovin': { wins: -5, firstClearAt: 'soon' },
            'not-an-encounter': { wins: 99 },
            'echoes-2-vetta': 'garbage',
        },
    });
    assert.deepEqual(parsed, { 'echoes-1-tovin': { wins: 0 } });
    const paid = applyEchoesVictory({ chroniclePoints: -400 }, echoesEncounterById('echoes-1-tovin')!, 10);
    assert.equal(paid.summary.balance, 50, 'a corrupted negative balance floors at zero before crediting');
});

test('client display data mirrors the server encounter table exactly', async () => {
    const client = await loadClientData();
    assert.equal(client.ECHOES_OPPONENTS.length, ECHOES_ENCOUNTERS.length);
    for (const def of ECHOES_ENCOUNTERS) {
        const mirror = client.ECHOES_OPPONENTS.find((opponent) => opponent.id === def.id);
        assert.ok(mirror, `client mirror exists for ${def.id}`);
        assert.equal(mirror!.floor, def.floor);
        assert.equal(mirror!.name, def.name);
        assert.equal(mirror!.title, def.title);
        assert.equal(mirror!.deckName, def.deckName);
        assert.equal(!!mirror!.isBoss, !!def.isBoss);
    }
    assert.equal(client.ECHOES_REWARD_DISPLAY.repeatWin, ECHOES_REWARDS.repeatWin);
    assert.equal(client.ECHOES_REWARD_DISPLAY.firstClearBonus, ECHOES_REWARDS.firstClearBonus);
    assert.equal(client.ECHOES_REWARD_DISPLAY.bossFirstClearBonus, ECHOES_REWARDS.bossFirstClearBonus);
    assert.equal(client.ECHOES_REWARD_DISPLAY.basicPackCost, ECHOES_REWARDS.basicPackCost);
});

test('every scene stays inside the handoff beat budget and every art asset exists', async () => {
    const client = await loadClientData();
    assert.deepEqual(
        Object.keys(client.ECHOES_SCENES),
        client.ECHOES_OPPONENTS.map((opponent) => opponent.id),
        'the authored scenes module covers exactly the shell opponents, in floor order',
    );
    for (const opponent of client.ECHOES_OPPONENTS) {
        const scenes = client.ECHOES_SCENES[opponent.id]!;
        const beats = (pages: ClientScenePage[]) => pages.reduce((total, page) => total + page.dialogue.length, 0);
        const pre = beats(scenes.preShowdown);
        const victory = beats(scenes.firstVictory);
        const defeat = beats(scenes.defeat);
        const rematch = beats(scenes.rematch);
        assert.ok(pre >= 8 && pre <= 18, `${opponent.id} pre-Showdown beats ${pre} in [8,18]`);
        assert.ok(victory >= 8 && victory <= 18, `${opponent.id} first-victory beats ${victory} in [8,18]`);
        assert.ok(defeat >= 2 && defeat <= 5, `${opponent.id} defeat beats ${defeat} in [2,5]`);
        assert.ok(rematch >= 2 && rematch <= 6, `${opponent.id} rematch beats ${rematch} in [2,6]`);
        for (const asset of [opponent.portrait, opponent.sceneImage]) {
            const onDisk = path.join(CLIENT_PUBLIC, asset.replace(/^\//, ''));
            assert.ok(fs.existsSync(onDisk), `${opponent.id} asset exists on disk: ${asset}`);
        }
    }
});
