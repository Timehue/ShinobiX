import { expect, test, type Route } from '@playwright/test';
import { createRequire } from 'node:module';
import {
    createFirstPactProgress,
    FIRST_PACT_STANDING_COURT_ROUNDS,
    type FirstPactProgress,
} from '../../shared/first-pact-contract';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// Synthetic API replies exercise the mounted App -> FirstPact ->
// PetShowdownBattle concession path. Server settlement is covered separately.
// Use the built engine for a valid four-pet session, as in ranked recovery.
const loadServerArtifact = createRequire(import.meta.url);
const { createShowdownSession, showdownStateView }: typeof import('../../api/_pet-showdown/engine') = loadServerArtifact('../../dist/api/_pet-showdown/engine.js');
const sessionKey = 'first-pact.showdown.v1';
const sessionId = 'first-pact-concession-recovery';
const playerName = 'AuditNinja';
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('First Pact concession retries retain recovery, then reset the displayed Standing Court round', async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const pets: Parameters<typeof createShowdownSession>[0]['playerPets'] = ['Rill', 'Moss', 'Kite', 'Bramble'].map((name, index) => ({
        id: `pact-concession-${index}`, templateId: `standard-${index + 1}`, name,
        rarity: 'standard', level: 70, xp: 0, maxLevel: 100, hp: 900, attack: 120, defense: 80, speed: 80,
        element: 'Fire', role: 'assassin', jutsus: [], unlockedForPve: true,
    }));
    const sitting = FIRST_PACT_STANDING_COURT_ROUNDS[3];
    let progress: FirstPactProgress = {
        ...createFirstPactProgress(1_700_000_000_000),
        chapter: 4, mainStep: 'complete', courtStanding: 1_600,
        flags: ['crossed-celestial-threshold', 'first-pact-complete'],
        standingCourt: { round: 3, best: 3, clears: 0, battleProofs: [] },
    };
    const state = showdownStateView(createShowdownSession({
        sessionId, playerName, format: '3v3', tier: 'champion', seed: 12345,
        playerPets: pets,
        enemyPets: pets.map(pet => ({ ...pet, id: `court-${pet.id}` })),
        enemyTeamName: sitting.opponent, rewardEligible: false,
    }));
    const save = uiAuditSave();
    save.character = { ...save.character, level: 100, activePetId: pets[0].id, pets };
    save.triggeredEvents = [
        ...(save.triggeredEvents as string[]),
        'story-interlude-stormveil-village-88',
        'story-interlude-stormveil-village-92',
        'story-stormveil-village-100-8',
    ];
    await installUiAuditRuntime(page, save);
    await page.addInitScript(({ key, breadcrumb }) => {
        localStorage.setItem('lastScreen.v1', 'firstPact');
        localStorage.setItem(key, JSON.stringify({ ...breadcrumb, savedAt: Date.now() }));
    }, { key: sessionKey, breadcrumb: { sessionId, playerName, encounterId: sitting.id, petIds: pets.map(pet => pet.id) } });
    await page.route('**/api/first-pact/state', route => json(route, { ok: true, progress }));
    const showdownActions: string[] = [];
    let concessions = 0;
    await page.route('**/api/pet/showdown', route => {
        const body = route.request().postDataJSON() as { action: string; playerName: string; sessionId: string };
        expect(body.playerName).toBe(playerName);
        expect(body.sessionId).toBe(sessionId);
        showdownActions.push(body.action);
        if (body.action === 'state') return json(route, { state });
        if (body.action === 'forfeit') {
            concessions += 1;
            if (concessions === 1) return json(route, { error: 'Temporary settlement failure.' }, 503);
            progress = { ...progress, standingCourt: { ...progress.standingCourt, round: 0, battleProofs: [] } };
            return json(route, { ok: true, conceded: true, firstPact: { progress } });
        }
        return json(route, { error: `Unexpected showdown action: ${body.action}` }, 400);
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const quest = page.locator('.fp-quest-card');
    await expect(quest).toContainText(sitting.title, { timeout: 30_000 });
    await expect(quest).toContainText('Sitting 4 of 5');
    await page.getByRole('button', { name: 'Forfeit the battle', exact: true }).click({ timeout: 45_000 });
    const confirmation = page.getByRole('alertdialog', { name: 'Forfeit the battle?', exact: true });
    await confirmation.getByRole('button', { name: 'Yes, concede', exact: true }).click();

    const error = page.locator('.fp-battle-network-error');
    await expect(error).toContainText('could not record the concession');
    await expect(confirmation).toBeVisible();
    await expect(quest).toContainText('Sitting 4 of 5');
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null')?.sessionId, sessionKey)).toBe(sessionId);
    // The confirmation owns focus until the concession succeeds. Retrying its
    // action also clears the previous error; no outside-modal dismissal is needed.
    await confirmation.getByRole('button', { name: 'Yes, concede', exact: true }).click();

    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Forfeit the battle', exact: true })).toHaveCount(0);
    await expect(quest).toBeVisible();
    await expect(quest).toContainText(FIRST_PACT_STANDING_COURT_ROUNDS[0].title);
    await expect(quest).toContainText('The Arbiter has reopened the docket');
    await expect(quest).not.toContainText('Sitting 4 of 5');
    expect(await page.evaluate(key => localStorage.getItem(key), sessionKey)).toBeNull();
    expect(concessions).toBe(2);
    expect(showdownActions).toEqual(['state', 'forfeit', 'forfeit']);
    expect(errors).toEqual([]);
});
