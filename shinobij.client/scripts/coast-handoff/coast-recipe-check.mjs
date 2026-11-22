import assert from 'node:assert/strict';

export async function checkLostLures({ page, board, world, list, readSave, capture, expect, touch, kind }) {
    const id = 'untamed-coast-1';
    const readQuest = async () => (await list()).lines.find(line => line.id === id);
    const quest = await readQuest();
    const initialCount = kind === 'one-lure' ? 1 : 0;
    assert.equal(quest.stage.need.have, initialCount);
    const lure = quest.remake.output;
    assert.equal(lure.itemId, 'quest-scent-lure');
    assert.equal(quest.stage.kind, 'deliver');
    const cardIn = area => area.locator('.quest-line-card').filter({ has: page.getByText(quest.title, { exact: true }) });
    const button = (area, name) => area.getByRole('button', { name, exact: true });
    await page.locator('#mission-tab-wandering').click();
    const journal = cardIn(page);
    await expect(journal).toContainText(/make scent lure again at the hound trace/i);
    await expect(button(journal, 'Make it again')).toHaveCount(0);
    await capture('journal', journal);

    await button(page, 'Go to the World Map').click();
    const sheet = page.locator('.coast-site-sheet');
    async function enter(sector, siteId) {
        const site = world.sectors[sector].sites.find(s => s.id === siteId);
        const keeper = (await list()).coast.figures.find(figure => figure.site === siteId);
        const entrance = button(board, keeper?.label ?? site.verb + ': ' + site.name);
        if (touch) await entrance.tap();
        else await entrance.click();
        await expect(sheet.getByRole('heading', { name: site.name, exact: true })).toBeVisible();
        return cardIn(sheet);
    }
    async function act(card, label, action) {
        const reply = page.waitForResponse(r => r.url().endsWith('/api/quests/lines') && r.request().postDataJSON()?.action === action);
        await button(card, label).click();
        const response = await reply;
        const body = await response.json();
        assert(response.ok() && body.ok, JSON.stringify(body));
        return body;
    }
    const trace = await enter(109, 'saltstair-tracks-109');
    await expect(trace).toContainText(/4\s*\/\s*4 Needle Fish|Needle Fish\s*4\s*\/\s*4/);
    await capture('recipe', trace);
    // Lose the list refresh after the successful write. Retry reads the saved
    // inventory without submitting the recipe or spending fish a second time.
    let made = 0, offline = true;
    const questRoute = '**/api/quests/lines';
    const interruptRefresh = route => {
        const action = route.request().postDataJSON()?.action;
        if (action === 'make') made++;
        if (action === 'list' && made && offline) return route.fulfill({ status: 503, json: { ok: false } });
        return route.continue();
    };
    await page.route(questRoute, interruptRefresh);
    const crafted = await act(trace, 'Make it again', 'make');
    await expect(sheet.getByRole('status').filter({ hasText: 'Your quests could not be read.' })).toBeVisible();
    await expect(button(sheet, 'Make it again')).toHaveCount(0);
    offline = false;
    await button(sheet, 'Try again').click();
    await expect(trace).toContainText(/2\s*\/\s*2 Scent Lure/);
    assert.equal(made, 1);
    await page.unroute(questRoute, interruptRefresh);
    assert.equal(crafted.advanced, false);
    assert.equal(crafted.madeAgain.itemId, lure.itemId);
    const ready = await readQuest();
    assert.equal(ready.stage.index, quest.stage.index);
    assert.equal(ready.stage.need.have, initialCount + lure.count);
    assert.equal(ready.remake, undefined);
    await expect(button(trace, 'Make it again')).toHaveCount(0);
    await button(sheet, 'Leave').click();

    for (const [from, to] of [[109, 106], [106, 110]]) {
        const edge = world.sectors[from].exits.find(e => e.destinationSector === to);
        const rect = await board.boundingBox();
        const position = { x: (edge.tile % 12 + .5) * rect.width / 12, y: (Math.floor(edge.tile / 12) + .5) * rect.height / 12 };
        const reply = page.waitForResponse(r => r.url().endsWith('/api/player/travel') && r.request().method() === 'POST');
        if (touch) await board.tap({ position });
        else await board.click({ position });
        assert((await reply).ok());
        await expect(board).toHaveAttribute('data-tile', String(edge.destinationTile));
    }
    const sill = await enter(110, 'saltstair-outcrop-110');
    await expect(button(sill, 'Make it again')).toHaveCount(0);
    assert.equal((await act(sill, 'Hand it over', 'advance')).advanced, true);
    const next = await readQuest();
    assert.equal(next.stage.need.itemId, 'quest-wrack-cord');
    assert.equal(next.remake, undefined);
    await expect(sill).toContainText(next.stage.text);
    const save = await readSave();
    assert.equal(save.questLines.active[id].delivered.set, lure.count);
    const remaining = save.character.itemStacks.find(stack => stack.itemId === lure.itemId)?.count ?? 0;
    assert.equal(remaining, initialCount);
    return { quest: quest.title, initialCount, remaining, recipe: lure, craftRequests: made, delivery: save.questLines.active[id].delivered.set, next: next.stage.text };
}
