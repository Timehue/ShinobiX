import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

/*
 * Real Express + disposable memory store (playwright.live.config.ts).
 *
 * "Set as Active" and "Set as 2v2 Partner" decide which five companions may
 * train. They used to be local edits carried by the debounced autosave, which
 * idle vitals regen can hold back for up to 15 s. Reproduced on 2026-09-18
 * against this server: Start Training pressed right after Set as Active was
 * refused ("Only companions in your active five-pet squad can train."), and
 * training a different pet inside that window handed back a character without
 * the new role, so the Active pick silently disappeared. Both roles now settle
 * through /api/pet/progress before the Pet Yard unlocks again.
 */
type Json = Record<string, unknown>;

function pet(id: string, templateId: string, name: string, element: string) {
    return {
        id, templateId, name, element, rarity: 'rare', level: 60, xp: 0, maxLevel: 100,
        hp: 420, attack: 72, defense: 58, speed: 64, jutsus: [], unlockedForPve: true,
        trait: 'Loyal', happiness: 88, origin: 'wild', generation: 0, breedingUsesMax: 8, breedingUsesRemaining: 8,
    };
}

const PETS = [
    pet('role-p1', 'rare-26', 'Ember Ocelot', 'Fire'),
    pet('role-p2', 'rare-1', 'Tideback Otter', 'Water'),
    pet('role-p3', 'rare-16', 'Gale Heron', 'Wind'),
    pet('role-p4', 'rare-21', 'Stoneback Tanuki', 'Earth'),
    pet('role-p5', 'rare-6', 'Volt Marten', 'Lightning'),
    pet('role-p6', 'rare-11', 'Mist Serpent', 'Water'),
];
const SIXTH = 'Mist Serpent';

async function seedSupporter(request: APIRequestContext, info: TestInfo, tag: string) {
    const name = `roles${tag}${info.project.name.includes('mobile') ? 'm' : 'd'}${Date.now().toString(36)}`;
    const registration = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'IsolatedRosterRoles!1234' } });
    expect(registration.status(), 'the isolated fixture account must register').toBe(200);
    const token = String((await registration.json()).token ?? '');
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const character = {
        name, village: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None',
        // Story is marked complete so no chapter scene covers the Pet Yard.
        level: 1, rankTitle: 'Academy Student', storyProgress: 99, storyVillage: 'Moonshadow Village',
        xp: 0, unspentStats: 0, starterCardsClaimed: true, chroniclePoints: 0, fateShards: 0, ryo: 50_000,
        tileCards: [], inventory: [], itemStacks: [], equipment: {}, pets: PETS,
        jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [],
        // Below max HP keeps idle regen ticking, which is what held the old
        // autosave back the longest.
        hp: 300, maxHp: 1000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
        stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense', 'bukijutsuDefense',
            'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map((k) => [k, 20])),
        onboardingStep: 'done', profession: 'healer', professionRank: 1, professionXp: 0, professionChosenAt: 1,
        examsPassed: ['genin', 'chunin', 'jonin'],
        patreon: { userId: 'roles-qa', tier: 'shinobi-supporter', active: true, entitledCents: 1500, updatedAt: Date.now(), source: 'admin' },
    };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' },
        data: { character, currentSector: 0, acceptedMissionIds: [], missionProgress: {},
            triggeredEvents: ['builtin-awakening-lv2', 'builtin-aura-sphere-lv9', 'builtin-hidden-dungeon'] },
    });
    expect(seeded.status(), 'admin fixture seed must commit before the browser starts').toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const readCharacter = async () => ((await (await request.get(`/api/save/${name}`, { headers })).json()) as Json).character as Json;
    const canonical = (await (await request.get(`/api/save/${name}`, { headers })).json()) as Json;
    expect(((canonical.character as Json).pets as unknown[]).length, 'six carried pets survive the seed').toBe(6);
    expect(((canonical.character as Json).patreon as Json)?.active, 'Supporter capacity survives the seed').toBe(true);
    return { name, token, canonical, readCharacter };
}

async function installSession(page: Page, account: Awaited<ReturnType<typeof seedSupporter>>) {
    await page.addInitScript(({ name, token, canonical, patch }) => {
        if (localStorage.getItem('roster-roles-qa-installed') === name) return;
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('roster-roles-qa-installed', name);
    }, { name: account.name, token: account.token, canonical: account.canonical, patch: LATEST_PATCH_NOTE.version });
}

async function openGrowth(page: Page, petName: string) {
    const closeOverlays = async () => {
        for (let i = 0; i < 6; i++) {
            const closer = page.getByRole('button', { name: /^Got it|Close briefing|Skip visual novel scene|^Skip$/i }).last();
            if (!(await closer.isVisible().catch(() => false))) break;
            await closer.click();
        }
    };
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Desktop reaches Pet Home from the side menu, phones from the village tile.
    const petHome = page.getByText('Pet Home', { exact: true }).filter({ visible: true }).first();
    await expect(petHome).toBeVisible({ timeout: 60_000 });
    await closeOverlays();
    await petHome.click();
    await closeOverlays();
    await page.getByRole('button', { name: 'Pet Yard', exact: true }).click();
    await expect(page.locator('.pet-yard-refined')).toBeVisible({ timeout: 30_000 });
    await closeOverlays();
    await selectGrowth(page, petName);
}

async function selectGrowth(page: Page, petName: string) {
    await page.getByRole('button', { name: `Select ${petName}` }).click();
    await page.getByRole('navigation', { name: 'Pet Yard activities' }).getByRole('button', { name: /Growth & training/ }).click();
    await expect(page.getByLabel('Duration', { exact: true })).toBeVisible();
}

const activeTag = (page: Page, petName: string) => page.locator('.pet-slot-card', { hasText: petName }).locator('.pet-active-tag');

test('a Supporter can train their sixth carried pet straight after Set as Active', async ({ page, request }, info) => {
    test.setTimeout(150_000);
    const account = await seedSupporter(request, info, 'a');
    await installSession(page, account);
    await openGrowth(page, SIXTH);
    // The gate's label is copy (PR #195 rewords it); what matters is that it is shut.
    await expect(page.getByRole('button', { name: /^Move into (?:carried roster|active five)$/ })).toBeDisabled();

    await page.getByRole('button', { name: 'Set as Active', exact: true }).click();
    const start = page.getByRole('button', { name: 'Start Training', exact: true });
    await expect(start).toBeEnabled();
    const started = page.waitForResponse((r) => r.url().includes('/api/pet/progress') && r.request().postDataJSON()?.action === 'start-training');
    await start.click();
    expect((await started).status(), 'the server already knows the new Active pick').toBe(200);
    await expect(page.locator('.game-alert-message')).toHaveCount(0);

    const stored = await account.readCharacter();
    expect(stored.activePetId).toBe('role-p6');
    expect((stored.pets as Json[]).find((p) => p.id === 'role-p6')?.training, 'training started on the sixth pet').toBeTruthy();
});

test('training another pet right after Set as Active keeps the Active pick', async ({ page, request }, info) => {
    test.setTimeout(150_000);
    const account = await seedSupporter(request, info, 'c');
    await installSession(page, account);
    await openGrowth(page, SIXTH);

    await page.getByRole('button', { name: 'Set as Active', exact: true }).click();
    await expect(activeTag(page, SIXTH)).toBeVisible();
    await selectGrowth(page, 'Ember Ocelot');
    const started = page.waitForResponse((r) => r.url().includes('/api/pet/progress') && r.request().postDataJSON()?.action === 'start-training');
    await page.getByRole('button', { name: 'Start Training', exact: true }).click();
    expect((await started).status()).toBe(200);

    await expect(activeTag(page, SIXTH), 'the reply to the other pet must not undo the Active pick').toBeVisible();
    // Past the old 3 s debounce, so a stale local copy would have been saved by now.
    await page.waitForTimeout(4_000);
    await expect(activeTag(page, SIXTH)).toBeVisible();
    expect((await account.readCharacter()).activePetId).toBe('role-p6');
});
