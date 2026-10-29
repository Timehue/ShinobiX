import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSoloPveAiEncounter } from './_ai-encounter.js';
import { attachHuntCombat } from './_hunt-combat.js';
import { attachStoryTwinCombat } from '../story/_twin-combat.js';
import { storyBossEnemyTemplate } from '../story/_authoritative-story-combat.js';
import { executeSoloPveAction, type SoloPveLock } from './_action-service.js';
import { readSoloPveSession, writeSoloPveSession, type SoloPveKv } from './_store.js';
import type { SoloPveSession } from './_session.js';

const NOW = 1_800_000_000_000;
const modes = ['solo', 'hunt-pack', 'hunt-waves', 'narrative-group', 'story-twins'] as const;

function encounter(mode: typeof modes[number], professionRank: number) {
    const pet = { id: 'selected-pet', templateId: 'starter-fire', name: 'Cinder Cub', nickname: 'Actual Companion',
        level: 75, hp: 1800, attack: 160, defense: 130, speed: 120, role: 'sage', trait: 'Loyal',
        happiness: 100, happinessDay: Math.floor(NOW / 86_400_000), loadout: {} };
    const character = { name: 'Summoner', village: 'Stormveil Village', level: 65, storyProgress: 4,
        specialty: 'Ninjutsu', profession: 'petTamer', professionRank, hp: 10000, maxHp: 10000,
        masterySpec: professionRank === 10 ? { 'pet-damage': 2, 'pet-hp': 2, 'alpha-bond': 1 } : undefined,
        chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        stats: { ninjutsuOffense: 1000, ninjutsuDefense: 1000, taijutsuDefense: 1000, speed: 1000 },
        jutsu: [], inventory: [], equipment: {}, pets: [pet], activePetId: pet.id };
    const profile = mode === 'story-twins'
        ? storyBossEnemyTemplate({ village: character.village, progressIndex: 4 })
        : { id: mode === 'narrative-group' ? 'road-ai-black-bridge' : 'summon-wiring-opponent',
            name: 'Audit Enemy', level: 50, hp: 10000, maxHp: 10000, stats: {}, jutsuIds: [] };
    const session = buildSoloPveAiEncounter({ sessionId: `summon-${mode}-${professionRank}`, playerName: 'summoner',
        save: { character }, profile, now: NOW, admin: null,
        encounter: { kind: mode === 'story-twins' ? 'story-boss' : 'generic-ai', id: 'Stormveil Village:4', sourceId: profile.id } });
    if (mode === 'story-twins') attachStoryTwinCombat(session);
    if (mode.startsWith('hunt-')) attachHuntCombat(session, { kind: 'hunt-pack', huntRunId: 'summon-hunt',
        sourceId: 'summon-hunt', sector: 1, stage: 0, displayName: 'Summon Hunt',
        huntFormation: { version: 1, kind: mode === 'hunt-waves' ? 'waves' : 'pack', count: 3 } });
    assert.equal(!!session.huntCombat, mode !== 'solo');
    return { session, character, pet };
}

for (const mode of modes) for (const rank of [9, 10]) for (const legacy of [false, true]) {
    test(`${mode}: rank-${rank} ${legacy ? 'legacy' : 'new'} summon survives admission, storage, response, projection and retries`, async () => {
        const { session, character, pet } = encounter(mode, rank);
        const price = rank === 10 ? 0 : 20;
        const expectedHp = rank === 10 ? 1944 : 1800;
        assert.equal(session.pendingCompanion?.summonApCost, price);
        assert.equal(session.pendingCompanion?.petId, pet.id);
        assert.equal(session.pendingCompanion?.name, pet.nickname);
        assert.equal(session.pendingCompanion?.hp, expectedHp);
        assert.equal(session.pendingCompanion?.reviveOnce, rank === 10 ? true : undefined);
        assert.equal(session.pendingCompanion?.speed, pet.speed);
        if (session.huntCombat) assert.deepEqual(session.huntCombat.battle.pendingCompanion, session.pendingCompanion);
        if (legacy) {
            delete session.pendingCompanion!.summonApCost;
            if (session.huntCombat) delete session.huntCombat.battle.pendingCompanion!.summonApCost;
        }

        // Exercise the actual store boundary with JSON serialization, as on reconnect.
        const rows = new Map<string, string>();
        const kv: SoloPveKv = {
            async get<T>(key: string) { return rows.has(key) ? JSON.parse(rows.get(key)!) as T : null; },
            async set(key: string, value: unknown) { rows.set(key, JSON.stringify(value)); return 'OK'; },
        };
        await writeSoloPveSession(session, { kv });
        character.professionRank = rank === 10 ? 9 : 10;
        pet.hp = 1;
        let writes = 0;
        const deps = { now: () => NOW + 1000, lock: (async (_key, fn) => fn()) as SoloPveLock,
            read: (id: string) => readSoloPveSession(id, { kv }),
            write: async (value: SoloPveSession) => { writes++; await writeSoloPveSession(value, { kv }); } };
        const command = { sessionId: session.sessionId, ownerSlug: 'summoner', expectedVersion: 1,
            moveToken: 'summon-wiring-request', action: mode === 'solo' ? { type: 'summon' as const }
                : { type: 'huntAction' as const, action: { type: 'summon' as const } } };
        const result = await executeSoloPveAction(command, deps);
        assert.equal(result.status, 200);
        assert.equal(result.body.applied, true, result.body.reason ?? 'summon accepted');
        const saved = (await readSoloPveSession(session.sessionId, { kv }))!;
        assert.equal(saved.ap.player, 100 - price);
        assert.equal(saved.pendingCompanion, undefined);
        assert.equal(saved.companionUsage?.petId, 'selected-pet');
        assert.equal(saved.huntCombat
            ? saved.huntCombat.battle.actors.find(actor => actor.character.companion)?.character.companionReviveAvailable
            : saved.companion?.reviveAvailable, rank === 10 ? true : undefined);
        assert.equal(saved.version, 2);
        const replay = await executeSoloPveAction(command, deps);
        assert.equal(replay.body.duplicate, true);
        assert.deepEqual(replay.body.session, JSON.parse(JSON.stringify(result.body.session)));
        assert.equal(writes, 1, 'lost-response retries cannot charge or heal twice');

        // These are the same adapters used by the mounted solo and group screens.
        const modulePath = mode === 'solo' ? '../../shinobij.client/src/lib/solo-pve-arena-adapter.js'
            : '../../shinobij.client/src/lib/hunt-combat-api.js';
        const adapter = await import(modulePath);
        const view = mode === 'solo' ? adapter.soloPveSessionForArena(saved) : adapter.huntSessionForTower(saved);
        assert.equal(view.activeAp, 100 - price);
        assert.equal(view.pendingCompanion, undefined);
        const actor = view.actors.find((candidate: { character: Record<string, unknown> }) => candidate.character.companion === true);
        assert.ok(actor, 'the summoned pet reaches the rendered actor collection');
        assert.equal(actor.name, 'Actual Companion');
        assert.equal(actor.maxHp, expectedHp, 'the admitted pet and its HP mastery reach the rendered actor');
        assert.equal(actor.character.companionRoundsLeft, 4);
    });
}
