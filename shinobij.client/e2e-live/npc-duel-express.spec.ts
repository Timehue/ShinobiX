import { expect } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { uniquePlayerName } from './helpers/player-names';
import { AURA_SPHERE_VN_ID } from '../src/constants/game';
import { CINDERHOLD_SECTORS, WORLD_GEO_VERSION } from '../../shared/sector-geo';
import { quietRoadCooldowns } from './helpers/quiet-road';

// Cinderhold Push 2 on the REAL Express server: the shinobi stand online in
// Cinderhold's sectors (server presence), a player attacks one through the
// ordinary world-attack routes, and the server plays the NPC's seat under the
// real PvP rules until the duel ends. The player only ever ends their turn.

type RosterRow = { name?: string; online?: boolean; currentSector?: number; village?: string; level?: number; character?: { village?: string; level?: number } };

test('a player attacks a Cinderhold shinobi and the server plays it to the end', async ({ request }) => {
    test.setTimeout(420_000);
    // The live harness runs with DISABLE_SCHEDULED_JOBS, so build the village the
    // way an operator would (the 03:00 UTC pass seeds it in production).
    const rebuilt = await request.post('/api/admin/npc-possess', { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: { action: 'rebuild' } });
    expect(rebuilt.status(), await rebuilt.text()).toBe(200);
    // The directory caches positions for 60 seconds. Acquire a fixture only
    // after a live heartbeat confirms the chosen NPC is still in its sector.
    type DuelFixture = {
        key: string;
        name: string;
        headers: Record<string, string>;
        npcName: string;
        sector: number;
        character: Record<string, unknown>;
    };
    let fixture: DuelFixture | undefined;
    await expect.poll(async () => {
        const rosterReply = await request.get('/api/player/roster');
        expect(rosterReply.status(), await rosterReply.text()).toBe(200);
        const roster = await rosterReply.json() as { players?: RosterRow[] };
        const target = roster.players?.find((p) => p.name && p.online
            && CINDERHOLD_SECTORS.includes(Number(p.currentSector))
            && (p.village ?? p.character?.village) === 'Cinderhold Village');
        if (!target) return false;
        const npcName = String(target.name), sector = Number(target.currentSector);
        const level = Number(target.level ?? target.character?.level ?? 40);
        const key = `${npcName.toLowerCase()}:${sector}:${level}`;
        if (fixture?.key !== key) {
            // A new directory location needs a fresh actor: an existing online
            // player's sector is lease-gated, not changed by reseeding its save.
            const name = uniquePlayerName((stamp) => `npcduel${stamp}`);
            const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'NpcDuelJourney!1234' } });
            expect(registered.status(), await registered.text()).toBe(200);
            const headers = { 'x-player-name': name, 'x-player-token': String((await registered.json()).token) };
            const character = {
                name, village: 'Moonshadow Village', storyVillage: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None',
                level, rankTitle: 'Jonin', xp: 0, unspentStats: 0, storyProgress: 99, onboardingStep: 'done', academyChecklistClaimed: true,
                starterCardsClaimed: true, examsPassed: ['genin', 'chunin', 'jonin'], hp: 500, maxHp: 500, chakra: 500, maxChakra: 500,
                stamina: 500, maxStamina: 500, ryo: 1000, inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [], jutsuMastery: [],
                equippedJutsuIds: [], pendingCombatMissionClaims: [], wandererCooldowns: quietRoadCooldowns([sector]),
            };
            const saved = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' },
                data: { character, worldGeoV: WORLD_GEO_VERSION, currentSector: sector, currentTile: 102, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [AURA_SPHERE_VN_ID] } });
            expect(saved.status(), await saved.text()).toBe(200);
            expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
            const canonicalReply = await request.get(`/api/save/${name}`, { headers });
            expect(canonicalReply.status(), await canonicalReply.text()).toBe(200);
            const canonical = await canonicalReply.json();
            fixture = { key, name, headers, npcName, sector, character: canonical.character };
        }
        const current = fixture!;
        const beat = await request.post('/api/player/heartbeat', { headers: current.headers,
            data: { name: current.name, sector: current.sector, tile: 102, character: current.character } });
        expect(beat.status(), await beat.text()).toBe(200);
        const live = await beat.json() as { sector?: number; traveling?: boolean; sectorMates?: Array<{
            name?: string; currentSector?: number; level?: number; inBattle?: boolean; travelingUntil?: number;
        }> };
        return Number(live.sector) === current.sector && live.traveling !== true && !!live.sectorMates?.some((p) =>
            p.name?.toLowerCase() === current.npcName.toLowerCase()
            && Number(p.currentSector) === current.sector && Number(p.level) === Number(current.character.level)
            && p.inBattle !== true && Number(p.travelingUntil ?? 0) <= Date.now());
    }, { timeout: 90_000, message: 'a Cinderhold shinobi is live beside its same-level challenger' }).toBe(true);
    const { name, headers, npcName, sector } = fixture!;

    // 3. The ordinary world attack starts a real PvP duel; the server seals it as an NPC duel.
    const attacked = await request.post('/api/player/attack', { headers, data: { targetName: npcName, attacker: { name } } });
    expect(attacked.status(), await attacked.text()).toBe(200);
    const created = await request.post('/api/pvp/session', { headers, data: { p1Character: { name }, p2Character: { name: npcName },
        baseRewards: true, rewardSector: sector, useCurrentVitals: true, requireWorldCoLocation: true } });
    expect(created.status(), await created.text()).toBe(200);
    const made = await created.json();
    const battleId = String(made.battleId);
    expect(made.session.rewardAuthority).toBe('world');
    expect(made.session.npcDuel).toMatchObject({ version: 1, seat: 'p2', paid: true });
    const joined = await request.post('/api/pvp/move', { headers, data: { battleId, role: 'p1', action: 'join', moveToken: 'join-p1' } });
    expect(joined.status(), await joined.text()).toBe(200);

    // 4. The server joins and plays the NPC; the player only ends their turns.
    let session: { status: string; winner: string | null; activePlayer: string; joined?: { p2?: boolean }; log: string[]; round: number } = made.session;
    let waits = 0;
    const deadline = Date.now() + 360_000;
    while (Date.now() < deadline) {
        session = await (await request.get(`/api/pvp/session?id=${battleId}`, { headers })).json();
        if (session.status === 'done') break;
        if (session.joined?.p2 && session.activePlayer === 'p1') {
            const ended = await request.post('/api/pvp/move', { headers, data: { battleId, role: 'p1', action: 'wait', moveToken: `wait-${++waits}` } });
            expect([200, 409]).toContain(ended.status());
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
    }
    expect(session.joined?.p2, 'the server took the NPC seat').toBe(true);
    expect(session.status, `still active at round ${session.round}`).toBe('done');
    expect(session.winner, 'an idle player loses to the NPC').toBe('p2');
    expect(session.log.some((line) => line.includes(npcName) && !/turn|waits/i.test(line)), 'the NPC fought, not just passed').toBe(true);

    // 5. The player claims the loss; the NPC's seat claims and frees itself.
    const lost = await request.post('/api/pvp/claim-rewards', { headers, data: { playerName: name, battleId, outcome: 'loss', completionVersion: 1 } });
    expect(lost.status(), await lost.text()).toBe(200);
    await expect.poll(async () => {
        const pending = await (await request.get(`/api/pvp/session?pending=1&playerName=${encodeURIComponent(npcName)}&recoveryProbeVersion=2`)).json().catch(() => ({}));
        return !(pending as { battleId?: string }).battleId;
    }, { timeout: 30_000, message: 'the NPC retires its battle so the next player can fight it' }).toBe(true);
});
