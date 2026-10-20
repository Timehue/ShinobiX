import { expect, type APIRequestContext, type Page, type Response, type TestInfo } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { uniqueNameStamp } from './helpers/player-names';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo';
import { SHOWDOWN_FORMAT_SIZE, type ShowdownFormat } from '../../shared/pet-showdown-contract';

/*
 * Hollow Gate "Send pet", end to end on the real Express server and its
 * disposable memory store (playwright.live.config.ts).
 *
 * "Send pet" on a Hollow Hound opens a server-authoritative Showdown duel
 * through POST /api/pet/showdown { action: 'hollow-gate' }. The server draws a
 * random 1v1, 2v2 or 3v3, capped by the ready carried pets; the active pet
 * leads and one Hollow Hound faces each fielded pet. A concession writes the
 * hg-pet-result receipt and /api/hollow-gate/combat-settle records a pet
 * defeat: the encounter is withdrawn unpaid and the run goes on.
 * api/hollow-gate/_pet-showdown-duel.integration.test.ts covers the handlers;
 * this spec covers the browser that drives them.
 *
 * WHAT GOES THROUGH THE API, AND WHY. Only the fixture:
 *   - POST /api/player-auth registers the account.
 *   - POST /api/save/<name>?signal=1 (admin) seeds the save: a level-60 diver
 *     holding one Hollow Gate Key and carrying three ready level-60 pets. The
 *     active pet is cleared for PvE, which the game sets at pet level 50.
 *   - POST /api/game-state { kind: 'villageState' } (admin) opens the village's
 *     Hollow Gate. In play a seated Kage buys that 30-day unlock with village
 *     seals; the browser refuses a fresh entry without it.
 *   - GET /api/save/<name> reads the server save, to check what was and was
 *     not paid.
 * ONE BROWSER REQUEST IS EDITED. Each /api/hollow-gate/floor-seal leaves
 * without its `wanderersVersion` opt-in, so the server seals the floor without
 * wanderers, as it does for an older browser. Since PR #347 (2026-10-12),
 * three hostile wanderers start on first-floor battle tiles and hunt the
 * diver. A step that ends within one tile of one is sealed as a battle ambush,
 * and a hunter must be fought as a shinobi. The nearest battle tile was often
 * a hunter's own starting tile, and the walk there met the hunter, so this
 * spec failed in 2 runs of 4 on 2026-10-14. Steering around the hunters does
 * not fix it: on about 45% of 320 sampled first floors, no walk within the
 * threat budget reached a Hound without coming within one tile of a hunter.
 * The wanderers are not this spec's subject, and
 * api/hollow-gate/_wanderers.integration.test.ts covers them.
 * WHAT GOES THROUGH THE UI. Everything else: the World Map landmark, the
 * entry menu and its key confirmation (the server start spends the real key),
 * the augment the server offered, the walk to a Hound on the D-pad (each tile
 * is a real /api/hollow-gate/step), the shrine's fighter choice, the duel, the
 * forfeit, a step off the tile, and a reload mid-duel.
 *
 * A RELOAD RETURNS TO THE SHRINE BY ITSELF. The drawn board never reaches the
 * save: the shrine counts as an unresolved battle (lib/screen-guards.ts
 * isUnresolvedBattle), so the autosave never runs there, and the unload
 * keepalive gives up on a save over 64 KiB (lib/save-unload.ts), which this
 * diver's save is. The server save holds only the server's tile-less run
 * projection, and the boot drops that (lib/normalize-character.ts). Until
 * 2026-09-25 that landed the player on the village, and walking back in
 * redrew floor 1 from the start. Now the boot asks /api/hollow-gate/resume
 * for the sealed run and rebuilds the same floor from the seed
 * (lib/hollow-gate-recovery.ts): the walked path, the chosen augment, the
 * position and the open duel all come back, without the World Map.
 *
 * The floor is generated from the server's seed, so the spec learns it from
 * the manifest /api/hollow-gate/floor-seal returns and plans the shortest walk
 * to a Hound over empty floor. The same reply lists the props' footprints.
 * They are solid: the browser bumps into one without sending a step, and the
 * server refuses one. A walk that ignored them ran into one on about 1 floor
 * in 500, so the plan treats them as walls. Every tile adds 4 threat and 100
 * opens an ambush, so the walk must stay under 25 steps. Of 20,000 seeded
 * first floors sealed this way, all but one had a Hound 2 to 22 steps away
 * (median 7). About one floor in 600 hid every Hound behind a trap, so a trap
 * is crossed only when there is no other way; its modal is answered like a
 * player would.
 *
 * The server's draw is random and this spec does not pin it: each run fights
 * whichever format was drawn and checks the browser against the server's
 * reply. The drawn format is recorded as a test annotation.
 *
 * Not covered here: a won duel. Winning needs a full fight against Hounds
 * that mirror the player's pets, with no reliable outcome. The integration
 * test proves a win pays exactly once.
 */

type Json = Record<string, unknown>;
type FloorManifest = {
    floor: number;
    width: number;
    height: number;
    spawn: { x: number; y: number };
    walkable: string;
    nodes: Record<string, string>;
};
/** A prop's ground footprint (shared/underground-floor-features.ts): solid tiles. */
type FloorFeature = { cells: number[] };
type Fighter = { id: string; name: string; level: number };
type DuelState = {
    sessionId: string;
    format: ShowdownFormat;
    round: number;
    finished: boolean;
    outcome: 'win' | 'loss' | null;
    player: Fighter[];
    enemy: Fighter[];
    enemyTeamName: string;
};
type DuelOpen = { ok: boolean; state: DuelState; petIds: string[]; resumed: boolean };
type SavedCharacter = {
    ryo: number;
    xp: number;
    hp: number;
    maxHp: number;
    hospitalized?: boolean;
    auraDust?: number;
    honorSeals?: number;
    boneCharms?: number;
    fateShards?: number;
    hollowShards?: number;
    itemStacks?: Array<{ itemId: string; count: number }>;
    hollowGateRun?: { runToken?: string; tiles?: unknown[]; activeCombat?: unknown } | null;
};

const ADMIN = 'live-express-e2e-admin';
const VILLAGE = 'Moonshadow Village';
/** api/game-state.ts keys each village row by its lower-cased letters and digits. */
const VILLAGE_STATE_KEY = 'moonshadowvillage';
const HOLLOW_GATE_KEY = 'hollow-gate-key';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Threat rises 4 per step and opens an ambush at 100 (api/hollow-gate/step.ts). */
const MAX_WALK_STEPS = 24;
const DUEL_TIMEOUT = 60_000;

function pet(id: string, templateId: string, name: string, element: string, move: string) {
    return {
        id, templateId, name, element, rarity: 'rare', level: 60, xp: 0, maxLevel: 100,
        hp: 420, attack: 72, defense: 58, speed: 64,
        jutsus: [{ name: move, power: 71, cooldown: 2, currentCooldown: 0, kind: 'damage' }],
        // The game clears a pet for PvE at level 50 (api/pet/_progress.ts).
        unlockedForPve: true,
        trait: 'Loyal', happiness: 88, origin: 'wild', generation: 0, breedingUsesMax: 8, breedingUsesRemaining: 8,
    };
}

function roster(tag: string) {
    // Three ready carried pets, so the server may draw any of 1v1, 2v2 or 3v3.
    return [
        pet(`hg-lead-${tag}`, 'rare-26', 'Ember Ocelot', 'Fire', 'Ember Ocelot Strike'),
        pet(`hg-mate-${tag}`, 'rare-1', 'Tideback Otter', 'Water', 'Tideback Otter Strike'),
        pet(`hg-wing-${tag}`, 'rare-16', 'Gale Heron', 'Wind', 'Gale Heron Strike'),
    ];
}

async function seedDiver(request: APIRequestContext, info: TestInfo) {
    const tag = uniqueNameStamp((stamp) => [`hgpet${stamp}`], { head: info.project.name.includes('mobile') ? 'm' : 'd' });
    const name = `hgpet${tag}`;
    const registered = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: 'HollowGatePetDuel!1234' },
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token ?? '');
    expect(token.length, 'the server must mint a session token').toBeGreaterThan(10);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const pets = roster(tag);
    const character = {
        name, village: VILLAGE, storyVillage: VILLAGE, specialty: 'Ninjutsu', bloodline: 'None',
        level: 60, rankTitle: 'Jonin', xp: 0, unspentStats: 0, storyProgress: 99,
        onboardingStep: 'done', academyChecklistClaimed: true, starterCardsClaimed: true,
        examsPassed: ['genin', 'chunin', 'jonin'], profession: 'vanguard', professionRank: 1,
        professionXp: 0, professionChosenAt: 1,
        hp: 900, maxHp: 900, chakra: 900, maxChakra: 900, stamina: 900, maxStamina: 900,
        stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense',
            'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense',
            'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map((key) => [key, 120])),
        ryo: 1000,
        // The shrine spends one Hollow Gate Key per fresh dive.
        inventory: [], itemStacks: [{ itemId: HOLLOW_GATE_KEY, count: 1 }],
        equipment: {}, pets, activePetId: pets[0].id,
        tileCards: [], jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [],
        seenHints: ['worldMap'], dailyTilesExplored: 0, totalTilesExplored: 0,
        // The three-page first-entry introduction is not what this spec covers.
        hollowGateIntroSeen: true,
    };
    const seedSave = () => request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': ADMIN },
        data: { character, worldGeoV: WORLD_GEO_VERSION, currentSector: 0, acceptedMissionIds: [], missionProgress: {},
            // A level-60 diver has already read the road interludes open to
            // its level (src/data/story-interludes.ts: 20, 30, 42 and 58).
            triggeredEvents: ['builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon',
                ...[20, 30, 42, 58].map((level) => `story-interlude-moonshadow-village-${level}`)] },
    });
    let seeded = await seedSave();
    if (seeded.status() === 429) {
        // Neighbouring live cases share the loopback save-burst bucket. Honour
        // the server's own retry hint rather than disabling the guard.
        const limited = await seeded.json().catch(() => ({})) as Json;
        const hinted = Number(limited.retryAfterMs);
        await new Promise((resolve) => setTimeout(resolve, (Number.isFinite(hinted) ? Math.min(5_000, Math.max(0, hinted)) : 3_100) + 100));
        seeded = await seedSave();
    }
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);

    // A seated Kage buys this 30-day unlock for the whole village with its
    // seals (api/village/hollow-gate-unlock.ts). The fixture has no Kage, so
    // the admin writes the same field the purchase writes.
    const unlocked = await request.post('/api/game-state', {
        headers: { 'x-admin-password': ADMIN },
        data: { kind: 'villageState', village: VILLAGE, state: { hollowGateUnlockedUntil: Date.now() + 30 * DAY_MS } },
    });
    expect(unlocked.status(), await unlocked.text()).toBe(200);

    const canonicalResponse = await request.get(`/api/save/${name}`, { headers });
    expect(canonicalResponse.status(), await canonicalResponse.text()).toBe(200);
    const canonical = await canonicalResponse.json() as Json & { character: SavedCharacter & { pets: Array<{ id: string }> } };
    expect(canonical.character.pets.map((owned) => owned.id), 'all three pets survive the seed').toEqual(pets.map((owned) => owned.id));
    const heartbeat = await request.post('/api/player/heartbeat', {
        headers, data: { name, sector: 0, character: canonical.character },
    });
    expect(heartbeat.status(), await heartbeat.text()).toBe(200);
    expect((await heartbeat.json()).forceReload, 'the acknowledged seed must not force a reload').not.toBe(true);

    const readCharacter = async (): Promise<SavedCharacter> => {
        const saved = await request.get(`/api/save/${name}`, { headers });
        expect(saved.status(), await saved.text()).toBe(200);
        return (await saved.json() as { character: SavedCharacter }).character;
    };
    return { name, token, pets, lead: pets[0], canonical, readCharacter };
}

type Diver = Awaited<ReturnType<typeof seedDiver>>;

async function installSession(page: Page, diver: Diver) {
    await page.addInitScript(({ name, token, canonical, patchVersion }) => {
        // Once per browser context, so the reload below keeps what the game wrote.
        if (localStorage.getItem('live-hg-pet-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patchVersion);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('live-hg-pet-installed', name);
    }, { name: diver.name, token: diver.token, canonical: diver.canonical, patchVersion: LATEST_PATCH_NOTE?.version ?? '' });
}

/** The next POST to `path` whose JSON body satisfies `match`. */
function apiReply(page: Page, path: string, match: (body: Json) => boolean = () => true, timeout = DUEL_TIMEOUT): Promise<Response> {
    return page.waitForResponse((response) => {
        if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== path) return false;
        try {
            return match((response.request().postDataJSON() ?? {}) as Json);
        } catch {
            return false;
        }
    }, { timeout });
}

async function jsonOf<T>(response: Response, label: string): Promise<T> {
    const text = await response.text();
    expect(response.status(), `${label}: ${text}`).toBe(200);
    return JSON.parse(text) as T;
}

/** Dismiss the ordinary notices a fresh session can raise over the map. */
async function clearNotices(page: Page) {
    for (let i = 0; i < 6; i++) {
        const closer = page.getByRole('button', { name: /^Got it|Close briefing|Skip visual novel scene|^Skip$/i }).last();
        if (!(await closer.isVisible().catch(() => false))) return;
        await closer.click();
    }
}

type WalkPlan = { kind: 'battle' | 'elite'; path: number[] };

/**
 * The shortest walk from the spawn to a Hollow Hound over empty floor. Other
 * tiles open their own modal or event, so they are refused, except a trap,
 * which is crossed only when nothing else reaches a Hound. A prop's footprint
 * is a wall. A plain Hound tile is preferred; an elite Hound is the same
 * encounter at a harder grade.
 */
function planWalk(manifest: FloorManifest, features: readonly FloorFeature[]): WalkPlan {
    const { width: w, height: h, walkable, nodes } = manifest;
    const solid = new Set(features.flatMap((feature) => feature.cells));
    const start = manifest.spawn.y * w + manifest.spawn.x;
    for (const kind of ['battle', 'elite'] as const) {
        const cost = new Map<number, number>([[start, 0]]);
        const previous = new Map<number, number>();
        const open = new Set<number>([start]);
        while (open.size) {
            let current = -1;
            for (const index of open) if (current < 0 || cost.get(index)! < cost.get(current)!) current = index;
            open.delete(current);
            if (nodes[String(current)] === kind) {
                const path = [current];
                while (path[0] !== start) path.unshift(previous.get(path[0])!);
                return { kind, path };
            }
            const x = current % w;
            const y = Math.floor(current / w);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const next = ny * w + nx;
                if (walkable[next] !== '1' || solid.has(next)) continue;
                const tile = nodes[String(next)];
                const stepCost = !tile || tile === kind ? 1 : tile === 'trap' ? 1_000 : Number.POSITIVE_INFINITY;
                const total = cost.get(current)! + stepCost;
                if (!Number.isFinite(total) || total >= (cost.get(next) ?? Number.POSITIVE_INFINITY)) continue;
                cost.set(next, total);
                previous.set(next, current);
                open.add(next);
            }
        }
    }
    throw new Error('No Hollow Hound can be reached from the spawn on this floor.');
}

const DPAD: Record<string, string> = { '1,0': 'Move right', '-1,0': 'Move left', '0,1': 'Move down', '0,-1': 'Move up' };

/** One tile on the shrine's D-pad. Resolves with the sealed step's reply. */
async function stepOnDpad(page: Page, width: number, from: number, to: number): Promise<Json> {
    const dx = (to % width) - (from % width);
    const dy = Math.floor(to / width) - Math.floor(from / width);
    const button = page.locator('.hollow-gate-shrine').getByRole('button', { name: DPAD[`${dx},${dy}`], exact: true });
    const sealed = apiReply(page, '/api/hollow-gate/step');
    await button.click();
    const body = await jsonOf<Json>(await sealed, `step to tile ${to}`);
    expect(body.position, 'the server accepts the tile the D-pad moved to').toEqual({ x: to % width, y: Math.floor(to / width) });
    return body;
}

function expectDuelMatchesServer(open: DuelOpen, diver: Diver): number {
    const { state, petIds } = open;
    const size = SHOWDOWN_FORMAT_SIZE[state.format];
    expect(['1v1', '2v2', '3v3'], 'the server drew a road-beast format').toContain(state.format);
    expect(state.finished).toBe(false);
    expect(state.player.map((fighter) => fighter.id), 'the fielded pets are the ones the server drew').toEqual(petIds);
    expect(petIds.length, `a ${state.format} fields ${size} pets`).toBe(size);
    expect(state.enemy.length, 'one Hollow Hound faces each fielded pet').toBe(size);
    expect(petIds[0], 'the pet the player sent leads').toBe(diver.lead.id);
    expect(new Set(petIds).size).toBe(size);
    for (const id of petIds) expect(diver.pets.map((owned) => owned.id)).toContain(id);
    for (const hound of state.enemy) expect(hound.id).toMatch(/^hollow-hound-encounter-\d{10,}$/);
    expect(state.enemyTeamName).toMatch(size === 1 ? /Hollow Hound$/ : /Hollow Hound Pack$/);
    return size;
}

async function expectDuelOnScreen(page: Page, state: DuelState, size: number) {
    const root = page.getByTestId('pet-showdown-root');
    await expect(root).toBeVisible({ timeout: DUEL_TIMEOUT });
    await expect(root).toHaveAttribute('aria-label', `Pet Showdown — your team against ${state.enemyTeamName}`);
    // The duel stays on the shrine screen; it never detours to the Pet Arena.
    await expect(page.locator('.app-shell').first()).toHaveAttribute('data-screen', 'hollowGateShrine');
    const mine = root.locator('.showdown-team-panel.player .showdown-plate');
    const theirs = root.locator('.showdown-team-panel.enemy .showdown-plate');
    await expect(mine, `every pet the server fielded in the ${state.format} is on screen`).toHaveCount(size);
    await expect(root.locator('.showdown-team-panel.player .showdown-plate-name')).toHaveText(state.player.map((fighter) => fighter.name));
    await expect(theirs, 'one Hound plate per fielded pet').toHaveCount(size);
    await expect(root.locator('.showdown-team-panel.enemy .showdown-plate-name')).toHaveText(state.enemy.map((fighter) => fighter.name));
}

type Dive = {
    started: { token: string; augmentOffers: Array<{ id: string; label: string }> };
    manifest: FloorManifest;
    plan: WalkPlan;
    hound: number;
    houndTile: { x: number; y: number };
    encounter: { runId: string; combatMode: string; resumed?: boolean };
    opened: DuelOpen;
    size: number;
};

/** World Map → the Hollow Gate landmark → "Enter the shrine". */
async function enterTheShrineFromTheMap(page: Page, info: TestInfo) {
    if (info.project.name.includes('mobile')) {
        // The phone map opens on the diver's own region; the Gate stands in the
        // bottom-centre one.
        await page.getByRole('group', { name: 'Jump to region' }).getByRole('button', { name: 'Central', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Enter Hollow Gate', exact: true }).click({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Enter the shrine', exact: true }).click();
}

/** Seal every floor without wanderers, as for an older browser (see the header). */
async function sealFloorsWithoutWanderers(page: Page) {
    await page.route('**/api/hollow-gate/floor-seal', async (route) => {
        const body = route.request().postDataJSON() as Json | null;
        if (!body) return route.continue();
        delete body.wanderersVersion;
        return route.continue({ postData: JSON.stringify(body) });
    });
}

async function startDiver(page: Page, request: APIRequestContext, info: TestInfo) {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const diver = await seedDiver(request, info);
    await installSession(page, diver);
    await sealFloorsWithoutWanderers(page);
    // Any other story scene that opens over the map is not this spec's
    // subject; skip it as a player would, whenever it appears.
    await page.addLocatorHandler(page.getByRole('dialog', { name: /visual novel scene/i }), async (scene) => {
        await scene.getByRole('button', { name: 'Skip', exact: true }).click();
    });
    return { diver, pageErrors };
}

/**
 * Everything from the World Map to an open duel, through the UI: enter the
 * shrine, seal the augment, walk the D-pad to a Hound, and choose "Send pet".
 */
async function reachHoundFromTheShrine(page: Page, info: TestInfo, diver: Diver): Promise<Omit<Dive, 'encounter' | 'opened' | 'size'>> {
    // The browser refuses a fresh dive until its poll of the shared village
    // state says the Gate is open, so wait for that reply before asking.
    const villageOpen = page.waitForResponse(async (response) => {
        if (response.request().method() !== 'GET' || new URL(response.url()).pathname !== '/api/game-state' || response.status() !== 200) return false;
        const frame = await response.json().catch(() => null) as { villageStates?: Record<string, { hollowGateUnlockedUntil?: number }> } | null;
        return Number(frame?.villageStates?.[VILLAGE_STATE_KEY]?.hollowGateUnlockedUntil ?? 0) > Date.now();
    }, { timeout: DUEL_TIMEOUT });
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible({ timeout: 45_000 });
    await clearNotices(page);
    await villageOpen;
    await enterTheShrineFromTheMap(page, info);
    const confirmEntry = page.getByRole('alertdialog', { name: 'Hollow Gate Shrine', exact: true });
    await expect(confirmEntry).toContainText('This consumes 1 Hollow Gate Key (1 owned).');
    const startReply = apiReply(page, '/api/hollow-gate/start');
    const sealReply = apiReply(page, '/api/hollow-gate/floor-seal');
    await confirmEntry.getByRole('button', { name: 'Enter', exact: true }).click();
    const started = await jsonOf<Dive['started']>(await startReply, 'hollow-gate/start');
    expect(started.token, 'the server minted the run token').toMatch(/^[a-f0-9]{32}$/);
    const floorSeal = await jsonOf<{
        manifest: FloorManifest;
        position: { x: number; y: number };
        floorFeatures?: FloorFeature[] | null;
        wanderers?: unknown[] | null;
    }>(await sealReply, 'hollow-gate/floor-seal');
    const manifest = floorSeal.manifest;
    expect(manifest.floor).toBe(1);
    expect(floorSeal.position, 'a fresh floor starts on its spawn').toEqual(manifest.spawn);
    expect(floorSeal.wanderers ?? [], 'the floor is sealed without wanderers').toEqual([]);
    await expect(page.locator('.app-shell[data-screen="hollowGateShrine"]')).toBeVisible({ timeout: 30_000 });
    const afterEntry = await diver.readCharacter();
    expect(afterEntry.itemStacks?.some((stack) => stack.itemId === HOLLOW_GATE_KEY && stack.count > 0) ?? false, 'the dive spent the key').toBe(false);
    expect(afterEntry.hollowGateRun?.runToken).toBe(started.token);

    // The server rolled the augment offers; take the first, as the board will
    // not move until one is sealed.
    const augments = page.getByRole('dialog', { name: 'Choose Your Hollow Gate Augment', exact: true });
    await expect(augments).toBeVisible();
    const chosen = started.augmentOffers[0];
    const chooseReply = apiReply(page, '/api/hollow-gate/choose-augment');
    await augments.getByRole('button', { name: chosen.label }).first().click();
    expect((await jsonOf<{ chosenAugmentId?: string }>(await chooseReply, 'choose-augment')).chosenAugmentId).toBe(chosen.id);
    await expect(augments).toHaveCount(0);
    await expect(page.locator('.hollow-gate-shrine [role="log"]')).toContainText(`Augment attuned: ${chosen.label}`);

    // Walk to a Hollow Hound on the D-pad. Every tile is a real sealed step.
    const plan = planWalk(manifest, floorSeal.floorFeatures ?? []);
    const steps = plan.path.length - 1;
    expect(steps, 'the walk must finish before threat opens an ambush').toBeLessThanOrEqual(MAX_WALK_STEPS);
    const hound = plan.path[steps];
    const houndTile = { x: hound % manifest.width, y: Math.floor(hound / manifest.width) };
    info.annotations.push({ type: 'hollow-gate-walk', description: `${steps} steps to a ${plan.kind} Hound at (${houndTile.x},${houndTile.y})` });
    for (let i = 1; i <= steps; i++) {
        const reply = await stepOnDpad(page, manifest.width, plan.path[i - 1], plan.path[i]);
        expect(reply.ambush ?? null, 'no ambush interrupts the walk').toBeNull();
        if (manifest.nodes[String(plan.path[i])] === 'trap') {
            const trap = page.getByRole('dialog', { name: 'Ancient Seal Trap', exact: true });
            await trap.getByRole('button', { name: 'Press on', exact: true }).click();
            await expect(trap).toHaveCount(0);
        }
    }

    return { started, manifest, plan, hound, houndTile };
}

async function sendPetFromTheShrine(page: Page, info: TestInfo, diver: Diver): Promise<Dive> {
    const { started, manifest, plan, hound, houndTile } = await reachHoundFromTheShrine(page, info, diver);
    // The shrine asks who fights. Send the pet.
    const sendPet = page.getByRole('button', { name: `Send ${diver.lead.name}`, exact: true });
    const choice = page.getByRole('dialog').filter({ has: sendPet });
    await expect(choice).toBeVisible();
    await expect(choice.getByRole('button', { name: 'Fight as shinobi', exact: true })).toBeVisible();
    await expect(choice).toContainText(`Pet combat is a Pet Colosseum duel led by ${diver.lead.name}: 1v1, 2v2 or 3v3 at random`);
    const encounterReply = apiReply(page, '/api/hollow-gate/combat-start', (body) => body.mode === 'pet');
    const duelReply = apiReply(page, '/api/pet/showdown', (body) => body.action === 'hollow-gate');
    await sendPet.click();
    const encounter = await jsonOf<Dive['encounter']>(await encounterReply, 'combat-start');
    expect(encounter.combatMode, 'combat-start sealed a Pet-mode encounter').toBe('pet');
    expect(encounter.resumed ?? false).toBe(false);
    const opened = await jsonOf<DuelOpen>(await duelReply, 'pet/showdown hollow-gate');
    expect(opened.resumed, 'the first open draws a new duel').toBe(false);
    const size = expectDuelMatchesServer(opened, diver);
    info.annotations.push({ type: 'hollow-gate-duel', description: `${opened.state.format}: ${opened.petIds.join(', ')}` });
    await expectDuelOnScreen(page, opened.state, size);
    return { started, manifest, plan, hound, houndTile, encounter, opened, size };
}

/** Concede through the battle UI; returns the concession and the Gate's settlement. */
async function forfeitTheDuel(page: Page, dive: Dive) {
    const forfeitReply = apiReply(page, '/api/pet/showdown', (body) => body.action === 'forfeit');
    const settleReply = apiReply(page, '/api/hollow-gate/combat-settle');
    await page.getByRole('button', { name: 'Forfeit the battle', exact: true }).click({ timeout: 45_000 });
    const confirmForfeit = page.getByRole('alertdialog', { name: 'Forfeit the battle?', exact: true });
    await confirmForfeit.getByRole('button', { name: 'Yes, concede', exact: true }).click();
    const conceded = await jsonOf<{ conceded?: boolean; state: DuelState; hollowGate?: { runId: string; petReceipt: string } }>(await forfeitReply, 'pet/showdown forfeit');
    expect(conceded.conceded).toBe(true);
    expect(conceded.state.finished).toBe(true);
    expect(conceded.state.outcome, 'a concession decides the duel as a loss').toBe('loss');
    expect(conceded.hollowGate, 'the concession mints the receipt the Gate settles')
        .toEqual({ runId: dive.encounter.runId, petReceipt: dive.opened.state.sessionId });
    const settled = await jsonOf<{ won: boolean; petDefeat: boolean; ended?: boolean; reward: Record<string, number>; character: SavedCharacter }>(await settleReply, 'hollow-gate/combat-settle');
    expect(settled.won).toBe(false);
    expect(settled.petDefeat, 'the Gate records a pet defeat').toBe(true);
    expect(Object.entries(settled.reward).filter(([, amount]) => amount !== 0), 'a pet defeat pays nothing').toEqual([]);
    await expect(page.getByTestId('pet-showdown-root')).toHaveCount(0);
    return settled;
}

test('Send pet opens the server-drawn duel on the shrine, and a forfeit settles an unpaid pet defeat', async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const { diver, pageErrors } = await startDiver(page, request, info);
    const dive = await sendPetFromTheShrine(page, info, diver);

    const before = await diver.readCharacter();
    expect(before.hollowGateRun?.runToken).toBe(dive.started.token);
    // Retain the actual fight presentation as well as the post-fight shrine.
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: info.outputPath('hollow-gate-pet-duel.png'), animations: 'disabled' });
    await forfeitTheDuel(page, dive);

    // The shrine shows the defeat, and the run goes on. The settle reply's
    // saved run has no board; drawing it crashed this screen until
    // hollowGateRunAfterPetDefeat kept the live one.
    const shrine = page.locator('.hollow-gate-shrine');
    await expect(shrine.getByRole('grid', { name: 'Floor 1 dungeon grid' })).toBeVisible();
    const recoil = Math.max(1, Math.floor(before.maxHp * 0.33));
    await expect(shrine.locator('[role="log"]')).toContainText(
        'The Hollow Hound wins the pet duel. The seal takes 33% of maximum HP, stopping at 1 HP; the encounter remains unresolved.',
    );
    await expect(shrine.getByRole('gridcell', {
        name: `${diver.name}, current location, row ${dive.houndTile.y + 1}, column ${dive.houndTile.x + 1}`,
    }), 'the diver still stands on the Hound tile').toBeVisible();

    const after = await diver.readCharacter();
    expect(after.hollowGateRun?.runToken, 'a pet defeat never ends the run').toBe(dive.started.token);
    expect(after.hollowGateRun?.activeCombat ?? null).toBeNull();
    expect(after.hospitalized ?? false).toBe(false);
    expect(after.hp, 'the seal recoils 33% of max HP with the existing 1 HP floor').toBe(Math.max(1, before.hp - recoil));
    for (const currency of ['ryo', 'xp', 'auraDust', 'honorSeals', 'boneCharms', 'fateShards', 'hollowShards'] as const) {
        expect(after[currency] ?? 0, `${currency} is unchanged: nothing was paid`).toBe(before[currency] ?? 0);
    }
    expect(after.itemStacks ?? []).toEqual(before.itemStacks ?? []);

    // A withdrawn encounter no longer pins the diver to its tile.
    const stepBack = await stepOnDpad(page, dive.manifest.width, dive.hound, dive.plan.path[dive.plan.path.length - 2]);
    expect(stepBack.ambush ?? null, 'no ambush meets the step back').toBeNull();
    await expect(shrine.getByRole('gridcell', { name: new RegExp(`^${diver.name}, current location`) })).toBeVisible();
    await page.screenshot({ path: info.outputPath('hollow-gate-pet-defeat-shrine.png'), animations: 'disabled' });
    expect(pageErrors, 'no uncaught page errors').toEqual([]);
});

test('an actual zero-HP legacy pet result closes the shrine and stays in hospital after retry and reload', async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const { diver, pageErrors } = await startDiver(page, request, info);
    const dive = await sendPetFromTheShrine(page, info, diver);
    const headers = { 'x-player-name': diver.name, 'x-player-token': diver.token };
    const read = await request.get(`/api/save/${diver.name}`, { headers });
    expect(read.status()).toBe(200);
    const legacy = await read.json() as Json & { character: SavedCharacter };
    const before = legacy.character;
    // Disposable local QA account only: reproduce an old zero-HP body with a
    // stranded pet binding. Keep the server-owned run and receipts unchanged.
    legacy.character = { ...before, hp: 0, hospitalized: false };
    const seeded = await request.post(`/api/save/${diver.name}?signal=1`, {
        headers: { 'x-admin-password': ADMIN }, data: legacy,
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${diver.name}?ack=1`, { headers })).status()).toBe(200);
    const settled = await forfeitTheDuel(page, dive);
    expect(settled.ended).toBe(true);
    expect(settled.character.hp).toBe(0);
    await expect(page.locator('.hospital-screen--admitted')).toBeVisible();
    await expect(page.locator('.hollow-gate-shrine')).toHaveCount(0);
    const replay = await request.post('/api/hollow-gate/combat-settle', { headers,
        data: { playerName: diver.name, token: dive.started.token, runId: dive.encounter.runId, petReceipt: dive.opened.state.sessionId },
    });
    expect(replay.status(), await replay.text()).toBe(200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.hospital-screen--admitted')).toBeVisible();
    const after = await diver.readCharacter();
    expect(after.hp).toBe(0);
    expect(after.hollowGateRun).toBeNull();
    expect(after.ryo).toBe(before.ryo);
    await page.screenshot({ path: info.outputPath('hollow-gate-ended-pet-hospital.png'), animations: 'disabled' });
    expect(pageErrors).toEqual([]);
});

type ResumeReply = {
    live: boolean;
    run: {
        token: string;
        floor: number;
        position: { x: number; y: number } | null;
        chosenAugmentId: string | null;
        visited: string | null;
        activeCombat: { runId: string; nodeId: string; floor: number; kind: string; mode?: string } | null;
    };
};

test('a shinobi encounter reload resumes the same fight and its terminal result returns to the saved destination', async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const { diver, pageErrors } = await startDiver(page, request, info);
    const dive = await reachHoundFromTheShrine(page, info, diver);
    const encounterReply = apiReply(page, '/api/hollow-gate/combat-start', body => body.mode === 'pve');
    await page.getByRole('button', { name: 'Fight as shinobi', exact: true }).click();
    const opened = await jsonOf<{ runId: string; session: { version: number } }>(await encounterReply, 'shinobi combat-start');
    await expect(page.locator('.mission-arena-fight')).toBeVisible();
    await page.screenshot({ path: info.outputPath('hollow-gate-shinobi-entry.png'), animations: 'disabled' });

    const resumedReply = apiReply(page, '/api/hollow-gate/combat-start', body => body.mode === 'pve', 150_000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const resumed = await jsonOf<{ runId: string; resumed: boolean }>(await resumedReply, 'shinobi reload');
    expect(resumed.runId).toBe(opened.runId);
    expect(resumed.resumed).toBe(true);
    await expect(page.locator('.app-shell[data-screen="hollowGateShrine"]')).toBeVisible();
    await expect(page.locator('.mission-arena-fight')).toBeVisible();

    const headers = { 'x-player-name': diver.name, 'x-player-token': diver.token };
    const stateReply = await request.get(`/api/solo-pve/state?sessionId=${opened.runId}&playerName=${diver.name}`, { headers });
    expect(stateReply.status()).toBe(200);
    const state = await stateReply.json();
    let allowSettle = false;
    await page.route('**/api/hollow-gate/combat-settle', async route => {
        if (!allowSettle) return route.fulfill({ status: 503, json: { error: 'Temporary local result outage.' } });
        return route.continue();
    });
    const abandoned = await request.post('/api/solo-pve/action', { headers, data: {
        playerName: diver.name, sessionId: opened.runId, type: 'abandon', expectedVersion: state.session.version,
        moveToken: `gate-abandon-${opened.runId}`,
    } });
    expect(abandoned.status(), await abandoned.text()).toBe(200);
    // Wait works even when the rolled augment seals retreat. The arena may
    // also learn the terminal state from a poll before this action lands.
    const result = page.getByRole('dialog', { name: 'Hollow Gate combat result', exact: true });
    const wait = page.locator('.mission-arena-fight').getByRole('button', { name: /Wait.*End turn/ });
    if (await wait.isEnabled()) await wait.click({ timeout: 1000 }).catch(async error => {
        if (!await result.isVisible()) throw error;
    });
    await expect(result.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(result.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
    const settledReply = apiReply(page, '/api/hollow-gate/combat-settle');
    allowSettle = true;
    await result.getByRole('button', { name: 'Retry', exact: true }).click();
    const settled = await jsonOf<{ won: boolean; revived?: boolean; escaped?: boolean; reward: Record<string, number> }>(await settledReply, 'shinobi settle');
    expect(settled.won).toBe(false);
    expect(Object.values(settled.reward ?? {}).every(amount => amount === 0)).toBe(true);
    await result.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('.mission-arena-fight')).toHaveCount(0);
    const saved = await diver.readCharacter();
    const survives = settled.revived || settled.escaped;
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', survives ? 'hollowGateShrine' : 'hospital');
    if (survives) expect(saved.hollowGateRun?.runToken).toBe(dive.started.token);
    else { expect(saved.hollowGateRun ?? null).toBeNull(); expect(saved.hospitalized).toBe(true); }
    await page.screenshot({ path: info.outputPath('hollow-gate-shinobi-return.png'), animations: 'disabled' });
    expect(pageErrors).toEqual([]);
});

test('a lost terminal resume reply recovers stale positive browser HP on the next reload', async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const { diver, pageErrors } = await startDiver(page, request, info);
    const dive = await sendPetFromTheShrine(page, info, diver);
    const headers = { 'x-player-name': diver.name, 'x-player-token': diver.token };
    const read = await request.get(`/api/save/${diver.name}`, { headers });
    const legacy = await read.json() as Json & { character: SavedCharacter & Json };
    const before = legacy.character;
    legacy.character = { ...before, hp: 0, hospitalized: false };
    const seeded = await request.post(`/api/save/${diver.name}?signal=1`, {
        headers: { 'x-admin-password': ADMIN }, data: legacy,
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${diver.name}?ack=1`, { headers })).status()).toBe(200);

    // Simulate an old cached browser drawing only. The real server save stays
    // at zero HP, and both terminal resume requests execute on Express.
    await page.route(`**/api/save/${diver.name}*`, async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        const saved = await response.json() as Json & { character?: Json };
        if (saved.character) saved.character = { ...saved.character, hp: before.hp, hospitalized: false,
            hollowGateRun: before.hollowGateRun, lastHollowGateStart: before.lastHollowGateStart };
        await route.fulfill({ response, json: saved });
    });
    let lostReply = false;
    await page.route('**/api/hollow-gate/resume', async route => {
        if (lostReply) return route.continue();
        const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
        const terminal = await response.json() as Json;
        expect(terminal.ended).toBe(true);
        expect(terminal.token).toBe(dive.started.token);
        lostReply = true;
        await route.abort('failed');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => lostReply, { timeout: 45_000 }).toBe(true);
    const committed = await diver.readCharacter();
    const replayReply = apiReply(page, '/api/hollow-gate/resume', () => true, 150_000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const replay = await jsonOf<Json>(await replayReply, 'terminal resume replay');
    expect(replay.ended).toBe(true);
    expect(replay.token).toBe(dive.started.token);
    await expect(page.locator('.hospital-screen--admitted')).toBeVisible();
    await expect(page.locator('.hollow-gate-shrine')).toHaveCount(0);
    const after = await diver.readCharacter();
    expect(after.hp).toBe(0);
    expect(after.hollowGateRun).toBeNull();
    expect(after.ryo).toBe(before.ryo);
    expect(after.hp).toBe(committed.hp);
    await page.screenshot({ path: info.outputPath('hollow-gate-resume-replay-hospital.png'), animations: 'disabled' });
    expect(pageErrors).toEqual([]);
});

test('a reload mid-duel returns to the shrine by itself and reopens the same Showdown session', async ({ page, request }, info) => {
    test.setTimeout(240_000);
    const { diver, pageErrors } = await startDiver(page, request, info);
    const dive = await sendPetFromTheShrine(page, info, diver);

    const resumeReply = apiReply(page, '/api/hollow-gate/resume', () => true, 150_000);
    const resumedEncounterReply = apiReply(page, '/api/hollow-gate/combat-start', (body) => body.mode === 'pet', 150_000);
    const resumedDuelReply = apiReply(page, '/api/pet/showdown', (body) => body.action === 'hollow-gate', 150_000);
    await page.reload({ waitUntil: 'domcontentloaded' });

    // The boot rebuilds the run from the server's sealed state (see the header),
    // with no World Map detour and no redrawn floor 1.
    const resume = await jsonOf<ResumeReply>(await resumeReply, 'hollow-gate/resume');
    expect(resume.live).toBe(true);
    expect(resume.run.token).toBe(dive.started.token);
    expect(resume.run.floor).toBe(1);
    expect(resume.run.position, 'the diver still stands on the Hound tile').toEqual(dive.houndTile);
    expect(resume.run.chosenAugmentId, 'the sealed augment comes back').toBe(dive.started.augmentOffers[0].id);
    expect(resume.run.activeCombat, 'the open duel comes back as a pet duel').toEqual({
        runId: dive.encounter.runId, nodeId: `floor:1:tile:${dive.hound}`, floor: 1, kind: dive.plan.kind, mode: 'pet',
    });
    for (const index of dive.plan.path) expect(resume.run.visited?.[index], `step ${index} of the walk is on record`).toBe('1');
    await expect(page.locator('.app-shell[data-screen="hollowGateShrine"]')).toBeVisible({ timeout: 45_000 });

    const resumedEncounter = await jsonOf<Dive['encounter']>(await resumedEncounterReply, 'combat-start after reload');
    expect(resumedEncounter.resumed, 'the shrine resumes the open encounter').toBe(true);
    expect(resumedEncounter.combatMode).toBe('pet');
    expect(resumedEncounter.runId).toBe(dive.encounter.runId);
    const resumed = await jsonOf<DuelOpen>(await resumedDuelReply, 'pet/showdown hollow-gate after reload');
    expect(resumed.resumed, 'the duel is reopened, not drawn again').toBe(true);
    expect(resumed.state.sessionId, 'same session').toBe(dive.opened.state.sessionId);
    expect(resumed.state.format, 'same format').toBe(dive.opened.state.format);
    expect(resumed.state.round, 'same round').toBe(dive.opened.state.round);
    expect(resumed.petIds, 'same fielded pets').toEqual(dive.opened.petIds);
    expect(resumed.state.enemy.map((fighter) => fighter.id), 'same Hounds').toEqual(dive.opened.state.enemy.map((fighter) => fighter.id));
    await expectDuelOnScreen(page, resumed.state, dive.size);
    await expect(page.getByRole('dialog', { name: 'Choose Your Hollow Gate Augment', exact: true }),
        'the sealed augment is not offered again').toHaveCount(0);

    // The reopened duel is the live one: conceding it settles the encounter.
    await forfeitTheDuel(page, dive);
    expect((await diver.readCharacter()).hollowGateRun?.runToken, 'the run survives the reload and the defeat').toBe(dive.started.token);

    // The rebuilt board is the explored one: the diver where they stood, and
    // every tile of the walk still known.
    const shrine = page.locator('.hollow-gate-shrine');
    await expect(shrine.getByRole('grid', { name: 'Floor 1 dungeon grid' })).toBeVisible();
    await expect(shrine.getByRole('gridcell', {
        name: `${diver.name}, current location, row ${dive.houndTile.y + 1}, column ${dive.houndTile.x + 1}`,
    })).toBeVisible();
    for (const index of dive.plan.path) {
        const row = Math.floor(index / dive.manifest.width) + 1;
        const column = (index % dive.manifest.width) + 1;
        await expect(shrine.getByRole('gridcell', { name: `Unknown tile, row ${row}, column ${column}`, exact: true }),
            `the walked tile at row ${row}, column ${column} is remembered`).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath('hollow-gate-reload-restored-shrine.png'), animations: 'disabled' });
    expect(pageErrors, 'no uncaught page errors').toEqual([]);
});
