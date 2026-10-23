import { expect, test, type Route } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { gatheringTool } from '../../shared/gathering-tools';

test.beforeEach(({ browserName }) => {
    // Chromium covers every width here (360, 390, 768 and 1366 px). WebKit's
    // page.route drops boot requests under load, which the page-error check
    // would report as a failure that has nothing to do with this layout.
    test.skip(browserName !== 'chromium', 'The loadout row is checked at every width in Chromium.');
});

// The pickaxe and fishing kunai live in the active loadout, on their own row
// under the feet, and still equip through the server-owned gathering endpoint.
test('gathering tools equip into their own row of the active loadout', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = uiAuditSave();
    save.currentSector = 0;
    let character: Record<string, unknown> = {
        ...save.character, inventory: ['tool-golden-pickaxe'], itemStacks: [], tileCards: [],
        equipment: { fishingPole: 'tool-basic-fishing-pole' }, gatheringToolUses: { 'tool-basic-fishing-pole': 47 },
    };
    save.character = character;
    const runtime = await installUiAuditRuntime(page, save);
    // Registered after the runtime, so it answers first. Mirrors equipGatheringTool.
    await page.route('**/api/world/resource', async (route: Route) => {
        const body = route.request().postDataJSON() as { action: string; itemId: string; unequip?: boolean };
        const tool = gatheringTool(body.itemId)!;
        const equipment = { ...(character.equipment as Record<string, string>) };
        let inventory = (character.inventory as string[]).filter(id => id !== body.itemId);
        if (body.unequip) { delete equipment[tool.slot]; inventory = [...inventory, body.itemId]; }
        else { if (equipment[tool.slot]) inventory = [...inventory, equipment[tool.slot]]; equipment[tool.slot] = body.itemId; }
        character = { ...character, equipment, inventory };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        await route.fulfill({ json: { ok: true, character, _saveVersion: version } });
    });
    await expectUiAuditBoot(page, runtime, 'inventory');

    await expect(page.getByRole('region', { name: 'Gathering equipment' })).toHaveCount(0);
    const loadout = page.locator('.inventory-equipped-panel');
    const fishing = loadout.getByRole('button', { name: /^Fishing equipment slot/ });
    const mining = loadout.getByRole('button', { name: /^Mining equipment slot/ });
    await expect(fishing).toHaveAccessibleName('Fishing equipment slot, equipped with Basic Fishing Kunai, 3 of 50 uses left');
    await expect(fishing.locator('.equip-slot-durability.low')).toHaveCount(1);
    await expect(mining).toHaveAccessibleName('Mining equipment slot, empty');

    // The new row sits under the feet, inside the figure's box, and overlaps no other slot.
    const boxes = await loadout.locator('.character-equip-slot').evaluateAll(slots => slots.map(slot => {
        const rect = slot.getBoundingClientRect();
        return { name: slot.getAttribute('aria-label') ?? '', left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    const layout = (await loadout.locator('.inventory-character-layout').boundingBox())!;
    const feet = boxes.find(box => box.name.startsWith('Feet '))!;
    for (const tool of boxes.filter(box => /^(Fishing|Mining) /.test(box.name))) {
        expect(tool.top).toBeGreaterThanOrEqual(feet.bottom);
        expect(tool.left).toBeGreaterThanOrEqual(layout.x - 1);
        expect(tool.right).toBeLessThanOrEqual(layout.x + layout.width + 1);
        expect(tool.bottom).toBeLessThanOrEqual(layout.y + layout.height + 1);
        for (const other of boxes.filter(box => box !== tool)) {
            const overlaps = tool.left < other.right && other.left < tool.right && tool.top < other.bottom && other.top < tool.bottom;
            expect(overlaps, `${tool.name} overlaps ${other.name}`).toBe(false);
        }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(loadout.locator('.inventory-panel-count')).toHaveAttribute('aria-label', '1 of 16 equipment slots filled');
    await loadout.screenshot({ path: info.outputPath('gathering-tool-loadout.png') });

    // An empty tool slot filters the backpack to that tool, which then equips into it.
    await mining.click();
    await expect(page.locator('.slot-filter-bar')).toContainText('Showing Pickaxe items');
    await page.getByRole('button', { name: 'Inspect Golden Pickaxe', exact: true }).click();
    const golden = page.getByRole('dialog', { name: 'Golden Pickaxe item details' });
    await golden.getByRole('button', { name: 'Equip to Pickaxe', exact: true }).click();
    await expect(golden).toHaveCount(0);
    await expect(mining).toHaveAccessibleName('Mining equipment slot, equipped with Golden Pickaxe, never breaks');
    await expect(mining.locator('.equip-slot-durability')).toHaveCount(0);

    // A filled tool slot opens the tool, whose durability and Unequip still work.
    await fishing.click();
    const rod = page.getByRole('dialog', { name: 'Basic Fishing Kunai item details' });
    await expect(rod).toContainText('Durability: 3 / 50 uses remaining');
    await rod.getByRole('button', { name: 'Unequip', exact: true }).click();
    await expect(rod).toHaveCount(0);
    await expect(fishing).toHaveAccessibleName('Fishing equipment slot, empty');
    expect(character.equipment).toEqual({ pickaxe: 'tool-golden-pickaxe' });
    expect(errors).toEqual([]);
});
