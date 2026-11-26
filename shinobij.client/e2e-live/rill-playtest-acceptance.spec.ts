import { expect, type Page } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { openWorld, seedWorldActor } from './helpers/world-actor';
import { sectorPositionModel } from '../../api/_coast-walk-space';
import { coastExits, coastLayout, coastSite } from '../../shared/coast-world';

const model = sectorPositionModel(101);
const now = Date.now();
function rounds(stage: number) {
    return { v: 1, active: { 'saltstair-rounds-2': { stage, at: now } },
        done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] },
            'saltstair-rounds-1': { at: 2, marks: 0 } } };
}

function card(page: Page) {
    return page.locator('.quest-line-card').filter({ hasText: /Saltstair Rounds II(?!I)/ });
}
async function openSite(page: Page, id: string) {
    const site = coastSite(id)!;
    await page.getByRole('button', { name: site.verb + ': ' + site.name, exact: true }).press('Enter');
    const dialog = page.getByRole('dialog', { name: site.name, exact: true });
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    return dialog;
}

test('Wrack Strand distinguishes both harvests, fills one quest cycle, and survives reload', async ({ page, request, context }, info) => {
    const site = coastSite('saltstair-harvest-102')!;
    const position = model.fallback(site.sector, site.approach)!;
    await seedWorldActor(request, context, position, model.location(position), {
        questLines: rounds(1), character: { level: 85, equipment: { kama: 'tool-basic-harvest-kama' }, gatheringToolUses: { 'tool-basic-harvest-kama': 0 } },
    });
    await openWorld(page);
    await page.getByRole('button', { name: 'Coast map', exact: true }).click();
    const atlas = page.getByRole('region', { name: 'Map of the Unmapped Coast' });
    await expect(atlas.getByText('Active quest destinations')).toBeVisible();
    await expect(atlas.getByText(/Sector 102 · Wrack Strand/).first()).toBeVisible();
    await expect(atlas.getByText(/Wrack Cord.*0\s*\/\s*6/i)).toBeVisible();
    await expect(atlas.getByRole('button', { name: 'You are here, Wrack Strand' })).toContainText('102');
    await expect(atlas.getByRole('button', { name: 'You are here, Wrack Strand' })).toBeInViewport();
    await page.screenshot({ path: info.outputPath('atlas-quest-goal.png') });
    await page.getByRole('button', { name: 'Sector', exact: true }).click();
    let panel = await openSite(page, site.id);
    const ordinary = panel.getByRole('button', { name: 'Harvest Wrack-line fibre', exact: true });
    const gather = () => panel.getByRole('button', { name: 'Harvest Wrack Cord', exact: true });
    await expect(ordinary).toBeEnabled();
    const actionRect = await gather().boundingBox();
    const ordinaryRect = await ordinary.boundingBox();
    expect(actionRect).not.toBeNull();
    expect(ordinaryRect).not.toBeNull();
    expect(ordinaryRect!.y - actionRect!.y).toBeGreaterThan(0);
    expect(ordinaryRect!.y - actionRect!.y).toBeLessThan(105);
    await gather().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('wrack-both-actions.png') });
    for (const count of [2, 4, 6]) {
        await gather().click();
        await expect(panel.getByText(new RegExp(`You hold ${count} of 6\\.`))).toBeVisible({ timeout: 20_000 });
    }
    await expect(gather()).toBeDisabled();
    await expect(panel.getByText('Attempts reset at')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openWorld(page);
    panel = await openSite(page, site.id);
    await expect(panel.getByText(/You hold 6 of 6\. You have 0 of 3 attempts/)).toBeVisible();
    await panel.locator('.quest-line-card').filter({ hasText: /Saltstair Rounds II(?!I)/ }).getByRole('button', { name: 'That is enough' }).click();
    await expect(panel.locator('.quest-line-card').filter({ hasText: /Saltstair Rounds II(?!I)/ }).getByText('Step 3 of 5')).toBeVisible();
});

test('Record House receives exactly six persisted Wrack Cord on the correct stage', async ({ page, request, context }) => {
    const site = coastSite('saltstair-counter-105')!;
    const position = model.fallback(site.sector, site.approach)!;
    const actor = await seedWorldActor(request, context, position, model.location(position), {
        questLines: rounds(3), character: { level: 85, itemStacks: [{ itemId: 'quest-wrack-cord', count: 6 }] },
    });
    await openWorld(page);
    const panel = await openSite(page, site.id);
    await panel.locator('.quest-line-card').filter({ hasText: /Saltstair Rounds II(?!I)/ }).getByRole('button', { name: 'Hand it over' }).click();
    await expect(card(page).getByText('Step 5 of 5')).toBeVisible();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openWorld(page);
    await openSite(page, site.id);
    await expect(card(page).getByText('Step 5 of 5')).toBeVisible();
    const saved = await (await request.get('/api/save/' + actor.name, { headers: actor.headers })).json();
    expect((saved.character.itemStacks ?? []).filter((row: {itemId: string}) => row.itemId === 'quest-wrack-cord')).toEqual([]);
});

test('a locked Coast trail explains the refusal without moving the player', async ({ page, request, context }) => {
    const from = 107, to = 132;
    const trail = coastExits(from).find(exit => exit.destinationSector === to)!;
    const position = model.fallback(from, trail.tile)!;
    const actor = await seedWorldActor(request, context, position, model.location(position), {
        questLines: rounds(1), character: { level: 85 },
    });
    await openWorld(page);
    const button = page.getByRole('button', { name: `Follow the ${trail.direction} trail to ${coastLayout(to)!.name}`, exact: true });
    await expect(button).toHaveAttribute('aria-description', 'That region of the coast is not open to you yet.');
    await button.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'That region of the coast is not open to you yet.' })).toBeVisible();
    const saved = await (await request.get('/api/player/world-move', { headers: actor.headers })).json();
    expect(saved.sector).toBe(from);
});

test('First Footing gives the exact approach, then advances at the Garrison', async ({ page, request, context }) => {
    const site = coastSite('saltstair-fort-107')!;
    const trail = coastExits(107).find(exit => exit.destinationSector === 109)!;
    const position = model.fallback(107, trail.tile)!;
    const state = rounds(1);
    await seedWorldActor(request, context, position, model.location(position), {
        questLines: { ...state, active: { 'first-footing': { stage: 1, at: now } } }, character: { level: 85 },
    });
    await openWorld(page);
    await page.getByRole('button', { name: /^Sector info/ }).click();
    const quest = page.locator('.quest-line-card').filter({ hasText: /First Footing/ });
    await quest.getByRole('button', { name: 'Go in' }).click();
    await expect(quest.getByRole('status')).toContainText(`Open ${site.name} from Places`);
    const names = await page.getByRole('button', { name: `${site.verb} ${site.name}`, exact: true }).count();
    expect(names).toBe(1);
    await page.getByRole('button', { name: `${site.verb} ${site.name}`, exact: true }).click();
    const panel = page.getByRole('dialog', { name: site.name, exact: true });
    await expect(panel).toBeVisible({ timeout: 90_000 });
    await panel.locator('.quest-line-card').filter({ hasText: /First Footing/ }).getByRole('button', { name: 'Go in' }).click();
    await expect(panel.locator('.quest-line-card').filter({ hasText: /First Footing/ }).getByText('Step 3 of 6')).toBeVisible();
});

test('the Record House and atlas show a competing reservation before a blocked hand-in', async ({ page, request, context }) => {
    const site = coastSite('saltstair-counter-105')!;
    const position = model.fallback(site.sector, site.approach)!;
    const state = rounds(3);
    await seedWorldActor(request, context, position, model.location(position), {
        questLines: { ...state, active: { ...state.active, 'first-footing': { stage: 4, at: now } } },
        character: { level: 85, itemStacks: [{ itemId: 'quest-wrack-cord', count: 6 }] },
    });
    await openWorld(page);
    await page.getByRole('button', { name: 'Coast map', exact: true }).click();
    const atlas = page.getByRole('region', { name: 'Map of the Unmapped Coast' });
    await expect(atlas.getByText(/Saltstair Rounds II.*\(6\/10\).*First Footing still needs 4/)).toBeVisible();
    await page.getByRole('button', { name: 'Sector', exact: true }).click();
    const panel = await openSite(page, site.id);
    const quest = panel.locator('.quest-line-card').filter({ hasText: /Saltstair Rounds II(?!I)/ });
    await expect(quest.getByText(/6\s*\/\s*10 Wrack Cord/)).toBeVisible();
    await expect(quest.getByText(/First Footing still needs 4/)).toBeVisible();
});

test('the Garrison arena retains its location and authored neutral terrain through reload', async ({ page, request, context }, info) => {
    const site = coastSite('saltstair-fort-107')!;
    const position = model.fallback(site.sector, site.approach)!;
    const state = rounds(1);
    await seedWorldActor(request, context, position, model.location(position), {
        questLines: { ...state, active: { 'first-footing': { stage: 2, at: now } } }, character: { level: 85 },
    });
    await openWorld(page);
    await page.getByRole('button', { name: /^Sector info/ }).click();
    const quest = page.locator('.quest-line-card').filter({ hasText: /First Footing/ });
    await quest.getByRole('button', { name: /^Fight .*patrol/i }).click();
    const scene = page.getByRole('dialog', { name: 'First Footing visual novel scene' });
    const arena = page.locator('.mission-arena-fight');
    await expect(scene.or(arena)).toBeVisible({ timeout: 45_000 });
    if (await scene.isVisible()) await scene.getByRole('button', { name: 'Skip', exact: true }).click();
    const verifyArena = async () => {
        await expect(arena).toBeVisible({ timeout: 80_000 });
        await expect(arena.locator('.twp-strip-biome')).toHaveText('Unmoored Garrison');
        await expect(arena.getByText('Neutral ground', { exact: true })).toBeVisible();
    };
    await verifyArena();
    await page.screenshot({ path: info.outputPath('arena-location.png') });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await verifyArena();
});
