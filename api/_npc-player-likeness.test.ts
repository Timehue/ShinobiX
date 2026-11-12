import assert from 'node:assert/strict';
import { before, test } from 'node:test';

// "As much like players as possible" (owner, 2026-11-10): the pass that made
// Cinderhold's shinobi think before they move, go to hospital when beaten, play
// as peers rather than teaching opponents, keep the levels and record they have
// really earned, and stay findable on the public index while off the map.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-player-likeness-session-secret-32';

let kv: typeof import('./_storage.js').kv;
let roster: typeof import('../shared/npc-village-roster.js');
let seed: typeof import('./_npc-village-seed.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    roster = await import('../shared/npc-village-roster.js');
    seed = await import('./_npc-village-seed.js');
    await kv.set('npc-village:state', { baseLevel: 40, target: 40, sample: 30, computedAt: Date.now() });
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
});

test('an NPC reads the board for a few seconds each turn, never answering instantly', async () => {
    const driver = await import('./_npc-duel-driver.js');
    const thinks = new Set<number>();
    for (let round = 1; round <= 40; round++) {
        const ms = driver.npcThinkMs('think-duel', round, 'p2');
        assert.ok(ms >= driver.NPC_THINK_MIN_MS && ms <= driver.NPC_THINK_MAX_MS, `${ms} ms`);
        assert.equal(driver.npcThinkMs('think-duel', round, 'p2'), ms, 'the same on every sweep and after a restart');
        thinks.add(ms);
    }
    assert.ok(thinks.size > 20, 'it varies turn to turn');
    // The whole turn (think time plus six beats at their longest) stays far inside the 45 s clock.
    assert.ok(driver.NPC_THINK_MAX_MS + 6 * driver.NPC_ACTION_BEAT_MS * 1.4 < 30_000);
    driver.setNpcActionBeatForTest(0);
    assert.equal(driver.npcThinkMs('think-duel', 1, 'p2'), 0, 'tests run the seat without it');
    driver.setNpcActionBeatForTest(driver.NPC_ACTION_BEAT_MS);
});

test('the seat plans as a peer: no low-level PvE easing, and only the planner copy is marked', async () => {
    const seat = await import('./_npc-ai-seat.js');
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'genin')!;
    const session = {
        battleId: 'peer-1', round: 1, activePlayer: 'p2', status: 'active', actionsThisTurn: 0,
        ap: { p1: 100, p2: 100 }, cooldowns: { p1: {}, p2: {} },
        p1: { name: 'someone', character: { name: 'someone', level: 12 }, hp: 100, maxHp: 100, pos: 10 },
        p2: { name: npc.name, character: { name: npc.name, level: 12 }, hp: 100, maxHp: 100, pos: 20 },
    } as never;
    const view = seat.projectForNpc(session, 'p2') as unknown as { enemy: { character: Record<string, unknown> } };
    assert.equal(view.enemy.character.pvpPeerAi, true);
    assert.equal((session as { p2: { character: Record<string, unknown> } }).p2.character.pvpPeerAi, undefined, 'the live session is untouched');
});

test('a move the engine refuses is taken out of the next plan, so the NPC tries something else', async () => {
    const seat = await import('./_npc-ai-seat.js');
    const view = { cooldowns: { enemy: {} }, itemCharges: { kunai: 3 }, environment: { blockedTiles: [] } } as never;
    seat.withoutRefusedMoves(view, [
        { action: 'jutsu', jutsuId: 'ember-fang' }, { action: 'item', itemId: 'kunai' }, { action: 'move', tile: 44 }, { action: 'clear' },
    ]);
    const v = view as unknown as { cooldowns: { enemy: Record<string, number> }; itemCharges: Record<string, number>; environment: { blockedTiles: number[] } };
    assert.equal(v.cooldowns.enemy['ember-fang'], 99);
    assert.equal(v.cooldowns.enemy.clear, 99);
    assert.equal(v.itemCharges.kunai, 0);
    assert.deepEqual(v.environment.blockedTiles, [44]);
});

test('a beaten NPC goes to hospital, then stands under the Field Recovery shield, like a player', async () => {
    const wounds = await import('./_npc-wounds.js');
    const { PVP_HOSPITAL_DURATION_MS, PVP_RAID_SHIELD_MS } = await import('./pvp/_vitals-settlement.js');
    const npc = roster.NPC_VILLAGE_ROSTER[9]!;
    const at = Date.now();
    await wounds.woundNpc(npc.id, at, 'winner', { ms: PVP_HOSPITAL_DURATION_MS, shieldMs: PVP_RAID_SHIELD_MS });
    const row = await wounds.readNpcWound(npc.id);
    assert.equal(wounds.woundActive(row, at + PVP_HOSPITAL_DURATION_MS - 1), true, 'in the hospital');
    assert.equal(wounds.woundActive(row, at + PVP_HOSPITAL_DURATION_MS + 1), false, 'back in the world');
    assert.equal(wounds.woundShieldUntil(row, at + PVP_HOSPITAL_DURATION_MS + 1), at + PVP_RAID_SHIELD_MS, 'but shielded');
    assert.equal(wounds.woundShieldUntil(row, at + PVP_RAID_SHIELD_MS + 1), 0, 'then fair game again');
    // A later, shorter wound never cuts a war wound short.
    await wounds.woundNpc(npc.id, at, 'warrior');
    await wounds.woundNpc(npc.id, at + 1_000, 'winner', { ms: PVP_HOSPITAL_DURATION_MS, shieldMs: PVP_RAID_SHIELD_MS });
    assert.equal((await wounds.readNpcWound(npc.id))?.until, at + wounds.NPC_WAR_WOUND_MS);
    const duel = await import('./_npc-duel.js');
    await assert.rejects(() => duel.sealNpcDuel({ battleId: 'shielded', rewardAuthority: 'world', p1: { name: 'anyone' }, p2: { name: npc.name } }, { sessionsEnabled: true }), /npc-duel-busy/);
    await kv.del(wounds.npcWoundKey(npc.id));
});

test('an NPC keeps the level it reached, its real record and its days in the world across rebuilds', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin')!;
    const levelOf = async () => Number((await kv.get<{ character: { level: number } }>(`save:${npc.id}`))!.character.level);
    const reached = await levelOf();
    const { npcLevelFor } = await import('./_npc-village-scaling.js');
    assert.ok(Math.abs(reached - npcLevelFor(npc.rank, 40)) <= 1, 'the scaled level, give or take its lean');
    assert.ok([-1, 0, 1].includes(seed.npcLevelLean(npc)));
    // The village's base falls: a player never loses levels, and neither does it.
    await kv.set('npc-village:state', { baseLevel: 25, target: 25, sample: 30, computedAt: Date.now() });
    await seed.seedNpcVillage();
    assert.equal(await levelOf(), reached);
    await kv.set('npc-village:state', { baseLevel: 40, target: 40, sample: 30, computedAt: Date.now() });
    // Its wins are PvP kills on its profile; the login streak counts its days.
    const { npcDuelRecordKey } = await import('./_npc-duel.js');
    await kv.set(npcDuelRecordKey(npc.id), { wins: 7, losses: 3, draws: 0, rivals: {} });
    await kv.set(`auth:${npc.id}`, { ...(await kv.get<Record<string, unknown>>(`auth:${npc.id}`)), createdAt: Date.now() - 4 * 86_400_000 });
    await seed.reseedNpc(npc.id);
    const character = (await kv.get<{ character: Record<string, unknown> }>(`save:${npc.id}`))!.character;
    assert.equal(character.totalPvpKills, 7);
    assert.equal(character.loginStreak, 5);
    assert.equal(character.ryo, 0, 'still no economy');
});

test('every NPC is on the public index, so its profile opens while it is off the map, and no board counts it', async () => {
    const { REGISTRY_KEY, buildPublicLeaderboards, parsePublicPlayerIndexEntry } = await import('./player/_public-index.js');
    const registry = (await kv.hgetall<Record<string, unknown>>(REGISTRY_KEY)) ?? {};
    for (const npc of roster.NPC_VILLAGE_ROSTER) {
        const entry = parsePublicPlayerIndexEntry(registry[npc.id], npc.id);
        assert.ok(entry, `${npc.id} is indexed`);
        assert.equal(entry!.name, npc.name);
        assert.equal(entry!.village, 'Cinderhold Village');
    }
    assert.equal(await seed.indexNpcVillage(), 0, 'an unchanged village writes nothing');
    const entries = Object.entries(registry).map(([key, raw]) => parsePublicPlayerIndexEntry(raw, key)!).filter(Boolean);
    const boards = JSON.stringify(buildPublicLeaderboards(entries as never, roster.NPC_VILLAGE_ROSTER.map((n) => n.id)));
    for (const npc of roster.NPC_VILLAGE_ROSTER) assert.ok(!boards.includes(`"${npc.name}"`), `${npc.name} ranks on no board`);
});

test('an NPC off the map is never left as a sleeper in the field', async () => {
    const camps = await import('./_realtime/sleeper-camps.js');
    const npc = roster.NPC_VILLAGE_ROSTER[4]!;
    await camps.setSleeperCamp({ name: npc.id, displayName: npc.name, sector: 67, createdAt: Date.now() });
    assert.equal(await camps.getSleeperCamp(npc.id), null);
});

test('an NPC carries a kit that grows with its level, alongside its banded weapon and armor', async () => {
    const kit = await import('./_npc-kit.js');
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.personality === 'aggressive')!;
    assert.deepEqual(Object.keys(kit.npcKitForLevel(npc, 1).equipment), ['thrown']);
    assert.deepEqual(Object.keys(kit.npcKitForLevel(npc, 10).equipment), ['thrown', 'item1']);
    assert.deepEqual(Object.keys(kit.npcKitForLevel(npc, 20).equipment), ['thrown', 'item1', 'item2']);
    assert.equal(kit.npcKitForLevel(npc, 30).equipment.item3, 'item-smoke-bomb');
    assert.equal(kit.npcKitForLevel(npc, 30).equipment.thrown, 'thrown-senbon', 'an attacker upgrades its throw');
    assert.equal(kit.npcKitForLevel(npc, 40).equipment.potion, 'potion-rejuvenation');
    const { ITEM_CATALOG } = await import('./pvp/_item-catalog.js');
    for (const shinobi of roster.NPC_VILLAGE_ROSTER) {
        for (const level of [1, 15, 35, 60, 100]) {
            const k = kit.npcKitForLevel(shinobi, level);
            for (const [slot, id] of Object.entries(k.equipment)) {
                const item = ITEM_CATALOG[id!];
                assert.ok(item, `${id} is a real item`);
                assert.equal(item!.slot === 'thrown' ? 'thrown' : item!.slot, slot === 'thrown' ? 'thrown' : slot === 'potion' ? 'potion' : 'item', `${id} fits ${slot}`);
                assert.ok(k.itemStacks.some((s) => s.itemId === id && s.count > 0), `${id} is in the pouch`);
            }
        }
    }
    // The save carries it, next to the level band's weapon and armor.
    const built = seed.buildNpcSave(npc, 45, null, 30) as { character: { equipment: Record<string, string>; itemStacks: Array<{ itemId: string; count: number }> } };
    const band = roster.npcGearForLevel(npc, 45);
    for (const [slot, id] of Object.entries(band)) assert.equal(built.character.equipment[slot], id);
    assert.equal(built.character.equipment.potion, 'potion-rejuvenation');
    assert.ok(built.character.itemStacks.some((s) => s.itemId === 'item-smoke-bomb' && s.count === 2));
});

test("the kit is sealed into a real duel like a player's, and the planner sees its pouch and weapon", async () => {
    const { sealItemCharges } = await import('./pvp/session.js');
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.personality === 'trickster')!;
    const save = seed.buildNpcSave(npc, 45, null, 30) as { character: Record<string, unknown> };
    const charges = sealItemCharges(save.character, save.character);
    assert.equal(charges['thrown-serpent-dust'], 5);
    assert.equal(charges['item-attack-pill'], 3);
    assert.equal(charges['item-smoke-bomb'], 2);
    assert.equal(charges['potion-rejuvenation'], 2, 'the potion keeps its two-a-fight cap');
    const seat = await import('./_npc-ai-seat.js');
    const fighter = (name: string, character: Record<string, unknown>, pos: number) => ({ name, character, hp: 1000, maxHp: 1000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500, pos, statuses: [], shield: 0 });
    const session = {
        battleId: 'kit-1', round: 2, activePlayer: 'p2', status: 'active', actionsThisTurn: 0,
        ap: { p1: 100, p2: 100 }, cooldowns: { p1: {}, p2: {} }, itemCharges: { p1: {}, p2: charges },
        p1: fighter('someone', { name: 'someone', level: 45 }, 10), p2: fighter(npc.name, { ...save.character }, 12),
    } as never;
    const view = seat.projectForNpc(session, 'p2') as unknown as { enemy: { character: Record<string, any> } };
    const pouch = view.enemy.character.inventory as string[];
    assert.equal(pouch.filter((id) => id === 'item-attack-pill').length, 3, 'one entry per charge, spent one at a time');
    const items = (view.enemy.character.pvpItems as Array<{ id: string }>).map((i) => i.id);
    for (const id of Object.values(save.character.equipment as Record<string, string>)) assert.ok(items.includes(id), `${id} resolvable`);
    assert.equal(view.enemy.character.pveWeaponPolicy, 'catalog-challenge-v1', 'its weapon is weighed like a player\'s');
    // A spent or refused item leaves the plan.
    seat.withoutRefusedMoves(view as never, [{ action: 'item', itemId: 'item-attack-pill' }]);
    assert.ok(!(view.enemy.character.inventory as string[]).includes('item-attack-pill'));
});
