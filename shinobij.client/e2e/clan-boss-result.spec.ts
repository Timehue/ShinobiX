import { test, expect, type Page } from '@playwright/test';
import { buildTowerEncounter } from '../../api/towers/_encounter';
import { CLAN_BOSS_FLOORS, getFloor } from '../../api/towers/_floor-catalog';
import { configureClanBossEncounter } from '../../api/clan-boss/_encounter-config';

const character = { name: 'Rill', level: 100, village: 'Ashen Leaf Village', specialty: 'Genjutsu',
    hp: 6_301, maxHp: 10_000, chakra: 500, maxChakra: 500, stamina: 500, maxStamina: 500,
    stats: { strength: 1000, speed: 1000, intelligence: 1000, willpower: 1000,
        taijutsuOffense: 1000, taijutsuDefense: 1000, ninjutsuOffense: 1000, ninjutsuDefense: 1000,
        genjutsuOffense: 1000, genjutsuDefense: 1000, bukijutsuOffense: 1000, bukijutsuDefense: 1000 },
    jutsu: [], jutsuMastery: [], equipment: {}, inventory: [], pets: [] };

async function openResult(page: Page, outcome: 'cap' | 'victory' | 'wipe', options: { reject?: boolean; ordinary?: boolean; reconnect?: boolean } = {}) {
    const floor = options.ordinary ? getFloor(1)! : CLAN_BOSS_FLOORS[3]!;
    const session = buildTowerEncounter({ floor, squad: [{ id: 'rill', name: 'Rill', ownerSlug: 'rill', ai: false, character }],
        runId: options.ordinary ? 'tower-result-qa' : 'cboss-result-qa', seed: 7, partySize: 1, now: 1 });
    if (!options.ordinary) {
        const boss = configureClanBossEncounter(session, floor, 22_000);
        boss.hp = outcome === 'victory' ? 0 : 5_253;
    }
    session.status = 'done'; session.winner = outcome === 'victory' ? 'squad' : 'enemy';
    session.round = outcome === 'cap' ? 21 : 10;
    session.objectiveState.completed = outcome === 'victory';
    session.objectiveState.failed = outcome !== 'victory';
    for (const actor of session.actors) {
        if (actor.side === 'squad') actor.hp = outcome === 'wipe' ? 0 : 6_301;
        else if (outcome === 'victory') actor.hp = 0;
    }
    await page.addInitScript(seed => { Object.assign(window, { clanResultSeed: seed }); }, { session, character });
    if (options.ordinary) await page.route('**/api/towers/settle', route => route.fulfill({ json: {
        settled: true, runId: session.runId, winner: session.winner, results: { rill: { paid: false, reason: 'already-paid' } },
    } }));
    const params = new URLSearchParams();
    if (options.reject) params.set('reject', '1');
    if (options.ordinary) params.set('ordinary', '1');
    await page.goto(`/e2e/fixtures/clan-boss-result.html?${params}`);
    if (options.reconnect) await page.reload(); // Rehydrate the same server-owned terminal session.
    return page.getByRole('dialog', { name: options.ordinary ? 'Floor 1 cleared' : outcome === 'cap' ? 'Assault limit reached' : outcome === 'victory' ? 'Assault victory' : 'Assault defeated', exact: true });
}

for (const outcome of ['cap', 'victory', 'wipe'] as const) test(`Clan Boss ${outcome} uses mode-specific outcome and actual Clan Hall return`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const result = await openResult(page, outcome);
    await expect(result).toContainText('Clan Boss');
    await expect(result).toContainText('Ancient Stone Golem');
    await expect(result).toContainText('Your contribution is saved to the clan boss operation.');
    await expect(result).not.toContainText('Floor 9004');
    await expect(result).not.toContainText('Battle Towers');
    if (outcome === 'cap') {
        await expect(result).toContainText('Round limit reached; boss still standing');
        await expect(result.locator('.tower-result-debrief')).toContainText('20 / 20');
        await expect(result.locator('.tower-result-debrief')).not.toContainText('21 / 20');
        await expect(result).not.toContainText('Assault victory');
        await page.screenshot({ path: info.outputPath('clan-golem-cap-result.png'), fullPage: true });
    }
    await result.getByRole('button', { name: 'Return to Clan Hall', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Clan Hall');
    expect(await page.evaluate(() => (window as unknown as { clanResultQa: object }).clanResultQa)).toEqual({ settlements: 1, exits: 1, commits: 1, bankings: 1 });
    expect(errors).toEqual([]);
});

test('Clan Boss refused settlement holds exit and retries once without claiming a saved result', async ({ page }) => {
    const result = await openResult(page, 'cap', { reject: true });
    await expect(result).toContainText('Contribution receipt pending.');
    await expect(result).not.toContainText('Your contribution is saved');
    await expect(result.getByRole('button', { name: 'Return to Clan Hall', exact: true })).toBeDisabled();
    await result.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(result).toContainText('Your contribution is saved to the clan boss operation.');
    await result.getByRole('button', { name: 'Return to Clan Hall', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Clan Hall');
    expect(await page.evaluate(() => (window as unknown as { clanResultQa: object }).clanResultQa)).toEqual({ settlements: 2, exits: 1, commits: 1, bankings: 1 });
});

test('a reconnected terminal assault keeps Clan Boss labels and the host return callback', async ({ page }) => {
    const result = await openResult(page, 'cap', { reconnect: true });
    await expect(result).toContainText('Your contribution is saved to the clan boss operation.');
    await result.getByRole('button', { name: 'Return to Clan Hall', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Clan Hall');
});

test('ordinary Tower result and return remain unchanged', async ({ page }) => {
    const result = await openResult(page, 'victory', { ordinary: true });
    await expect(result).toContainText('Battle Towers');
    await expect(result).not.toContainText('Clan Boss');
    await expect(result).not.toContainText('Your contribution is saved');
    await result.getByRole('button', { name: 'Return to the Tower', exact: true }).click();
    await expect(page.getByTestId('returned-screen')).toHaveText('Battle Towers');
});
