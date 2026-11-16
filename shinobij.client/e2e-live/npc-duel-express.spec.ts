import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from './helpers/reconnecting-request';
import { uniquePlayerName } from './helpers/player-names';
import { AURA_SPHERE_VN_ID } from '../src/constants/game';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { storyInterludesByVillage } from '../src/data/story-interludes';
import { isWildSector, WORLD_GEO_VERSION } from '../../shared/sector-geo';
import { NPC_VILLAGE_ROSTER } from '../../shared/npc-village-roster';
import { accountKey } from '../src/lib/player-accounts';
import { quietRoadCooldowns } from './helpers/quiet-road';

// Cinderhold Push 2 on the REAL Express server: the shinobi stand online on
// their world routes (server presence), a player attacks one through the
// ordinary world-attack routes, and the server plays the NPC's seat under the
// real PvP rules until the duel ends. The player only ever ends their turn.

type RosterRow = { name?: string; online?: boolean; currentSector?: number; village?: string; level?: number; character?: { village?: string; level?: number } };

function artDigest(body: Buffer) {
    return createHash('sha256').update(body).digest('hex');
}

async function combatModelArt() {
    const receipt = process.env.SECTOR_MODEL_LIVE_RECEIPT;
    const content = process.env.SECTOR_MODEL_TEST_PLAYER_CONTENT;
    if (receipt && content) {
        const model = JSON.parse(await readFile(receipt, 'utf8')) as { assetId: string; version: string };
        const folder = resolve(content, 'players', model.assetId);
        const manifest = await readFile(resolve(folder, `${model.version}.json`));
        const { battleSprite } = JSON.parse(manifest.toString());
        const sprite = await readFile(resolve(folder, battleSprite));
        return { model, manifest, sprite, battleSprite };
    }
    const sprite = await readFile(resolve('public/combat-actors/starters/starter-two-idle.webp'));
    const battleSprite = `${artDigest(sprite)}.webp`;
    const manifest = Buffer.from(JSON.stringify({ format: 'sector-motion-v2', battleSprite }));
    return { model: { assetId: '2'.repeat(32), version: artDigest(manifest) }, manifest, sprite, battleSprite };
}

test('a player attacks a Cinderhold shinobi and the server plays it to the end', async ({ request, page }, info) => {
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
            && isWildSector(Number(p.currentSector))
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
                avatarImage: '/starter-avatar-one.webp',
                level, rankTitle: 'Jonin', xp: 0, unspentStats: 0, storyProgress: 99, onboardingStep: 'done', academyChecklistClaimed: true,
                starterCardsClaimed: true, examsPassed: ['genin', 'chunin', 'jonin'], hp: 500, maxHp: 500, chakra: 500, maxChakra: 500,
                stamina: 500, maxStamina: 500, ryo: 1000, inventory: [], itemStacks: [], equipment: {}, pets: [], tileCards: [], jutsuMastery: [],
                equippedJutsuIds: [], pendingCombatMissionClaims: [], wandererCooldowns: quietRoadCooldowns([sector]),
            };
            const seenInterludes = (storyInterludesByVillage['Moonshadow Village'] ?? []).map(entry => entry.id);
            const saved = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' },
                data: { character, worldGeoV: WORLD_GEO_VERSION, currentSector: sector, currentTile: 102, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [AURA_SPHERE_VN_ID, ...seenInterludes] } });
            expect(saved.status(), await saved.text()).toBe(200);
            expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
            if (level >= 13) {
                const chosen = await request.post('/api/profession/choose', { headers, data: { playerName: name, profession: 'vanguard' } });
                expect(chosen.status(), await chosen.text()).toBe(200);
            }
            const claimed = await request.post('/api/events/claim', { headers, data: { playerName: name, eventId: AURA_SPHERE_VN_ID } });
            expect(claimed.status(), await claimed.text()).toBe(200);
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

    const npc = NPC_VILLAGE_ROSTER.find(entry => entry.name.toLowerCase() === npcName.toLowerCase());
    expect(npc).toBeDefined();
    const art = await combatModelArt();
    const artBase = 'https://combat-art.example.invalid/sector-models';
    const brokenImage = Buffer.from('unreadable image');
    const brokenFilename = `${artDigest(brokenImage)}.webp`;
    const brokenManifest = Buffer.from(JSON.stringify({ format: 'sector-motion-v2', battleSprite: brokenFilename }));
    const brokenVersion = artDigest(brokenManifest);
    let version = art.model.version;
    const modelRequests: string[] = [];
    await page.route(`**/api/save/${name}*`, async route => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const save = await response.json();
        await route.fulfill({ response, json: { ...save, character: { ...save.character, playerModel: { ...art.model, version } } } });
    });
    await page.route('**/api/world/sector-layout', route => route.fulfill({ json: { obstaclesEnabled: true, modelArtBase: artBase } }));
    const objects = new Map<string, Buffer>([
        [`${art.model.version}.json`, art.manifest], [art.battleSprite, art.sprite],
        [`${brokenVersion}.json`, brokenManifest], [brokenFilename, brokenImage],
    ]);
    await page.route(`${artBase}/players/**`, route => {
        const path = new URL(route.request().url()).pathname;
        modelRequests.push(path);
        const file = path.split('/').pop()!;
        const body = objects.get(file);
        return route.fulfill({ status: body ? 200 : 404, body, headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: file.endsWith('.webp') ? 'image/webp' : 'application/json' });
    });
    await page.addInitScript(({ player, token, id, owner, patchVersion }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: player }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [player]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', player);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        if (patchVersion) localStorage.setItem('patchNotes.lastSeenVersion.v1', patchVersion);
        localStorage.setItem('pvpSession.v1', JSON.stringify({
            owner, pvpBattleId: id, pvpRole: 'p1', pvpBattleContext: { mode: 'standard' }, savedAt: Date.now(),
        }));
        localStorage.setItem('lastScreen.v1', 'pvpBattle');
    }, { player: name, token: headers['x-player-token'], id: battleId, owner: accountKey(name), patchVersion: LATEST_PATCH_NOTE?.version });
    await page.goto('/#/pvpBattle', { waitUntil: 'domcontentloaded' });
    const board = page.locator('.pvp-battle-layout');
    const opponent = board.locator('[data-battlefield-actor-id="p2"] .battlefield-actor-sprite');
    const player = board.locator('[data-battlefield-actor-id="p1"] .battlefield-actor-sprite');
    await expect(opponent).toHaveAttribute('src', `/combat-actors/cinderhold/${npc!.id}-idle.webp`);
    await expect.poll(() => opponent.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(player).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => player.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('.pp-root')).toBeHidden();
    await expect(board.locator('.pvp-countdown-overlay')).toBeHidden();
    await board.locator('.hex-battlefield').screenshot({ path: info.outputPath('cinderhold-duel-board.png') });

    version = brokenVersion;
    const badSpriteRequest = page.waitForResponse(response => response.url().endsWith(`/${brokenFilename}`));
    await page.reload({ waitUntil: 'domcontentloaded' });
    expect((await badSpriteRequest).ok()).toBe(true);
    await expect(player).toHaveAttribute('src', '/combat-actors/starters/starter-one-idle.webp');
    expect(modelRequests.every(path => path.startsWith(`/sector-models/players/${art.model.assetId}/`))).toBe(true);
    await page.close();

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
