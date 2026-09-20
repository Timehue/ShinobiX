import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

/*
 * The open market is filtered, sorted and paged by the SERVER: the browse reply
 * carries one page, and changing filters or pages asks for the next one with a
 * read-only `market` request instead of re-running a whole browse. The screen
 * has to show what the server sent — including the page IT clamped to — and it
 * must not fire one request per keystroke.
 *
 * The client-side fallback (a server that still sends every listing) is covered
 * by the Sunscar section of pet-home-visual.spec.ts, which mocks that shape.
 */

const PAGE_SIZE = 12;
const LOTS = Array.from({ length: 30 }, (_, i) => ({
    id: `lot-${i}`,
    asset: {
        id: `item-${i}`, name: i % 10 === 3 ? `Dune lantern ${i}` : `Desert keepsake ${i}`, kind: 'item',
        category: 'materials', rarity: 'uncommon', description: 'From the trading quarter.',
        image: '/items/hunt-torn-hide-v1.webp', stats: [],
    },
    price: 100 + i, quantity: 1, currency: 'ryo', seller: 'miraa', sellerName: 'Miraa',
    state: 'active', createdAt: 1_700_000_000_000 - i,
}));

/** What the server does with a market query, in miniature. */
function marketPage(query: { search?: string; page?: number }) {
    const search = String(query.search ?? '').trim().toLowerCase();
    const matching = search
        ? LOTS.filter(lot => lot.asset.name.toLowerCase().includes(search) || lot.sellerName.toLowerCase().includes(search))
        : LOTS;
    const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, Math.floor(Number(query.page) || 1)), pages);
    return {
        v: 2, query: { ...query, page }, page, pageSize: PAGE_SIZE, pages, total: matching.length,
        listings: matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    };
}

test('the Exchange shows the server\'s market page, and a typed search settles into one of them', async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, ryo: 500_000 };
    const runtime = await installUiAuditRuntime(page, save);
    const asked: Array<{ action?: string; market?: { search?: string; page?: number } }> = [];
    await page.route('**/api/festival/exchange', async route => {
        const body = route.request().postDataJSON() as { action?: string; market?: { search?: string; page?: number } };
        asked.push(body);
        // Every request carries the query; the server answers with ONE page.
        expect(body.market, 'the client always states which page of the market it wants').toBeTruthy();
        const market = marketPage(body.market!);
        if (body.action === 'market') return route.fulfill({ json: { ok: true, market } });
        return route.fulfill({
            json: {
                ok: true, market, activity: [], inventory: [], creatorItems: [], recoveryErrors: [],
                character: save.character, _saveVersion: runtime.currentVersion(),
            },
        });
    });

    await page.goto('/#/sunscarFestival', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Enter the Exchange', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sunscar Exchange', exact: true })).toBeFocused();

    // One page of the market, and the count is the whole result set behind it.
    await expect(page.locator('.sx-listing')).toHaveCount(PAGE_SIZE);
    await expect(page.locator('.sx-count')).toHaveText('30 listings');
    await expect(page.getByText('Page 1 of 3')).toBeVisible();
    expect(asked.filter(request => request.action === 'browse')).toHaveLength(1);

    // Paging asks the server for that page — never a second browse.
    await page.getByRole('button', { name: 'Next →', exact: true }).click();
    await expect(page.getByText('Page 2 of 3')).toBeVisible();
    await expect(page.locator('.sx-listing').first()).toContainText('Desert keepsake 12');
    expect(asked.filter(request => request.action === 'browse')).toHaveLength(1);
    expect(asked.at(-1)).toMatchObject({ action: 'market', market: { page: 2 } });

    // Searching asks the server once, for the settled term at the first page of
    // its own result set. A search also resets the page on the spot (the other
    // tabs filter as you type), and on page 2 that reset alone would ask for the
    // page 1 the player is already typing past — so ONE input has to stay one
    // request. Set the term in a single input event rather than typing it: how
    // many keystrokes land inside the 300ms debounce is the machine's timing,
    // not the screen's behaviour, and WebKit under a parallel run is slow enough
    // to settle a word mid-way.
    const term = 'lantern';
    const before = asked.length;
    await page.getByRole('searchbox', { name: 'Search the Exchange' }).fill(term);
    await expect(page.locator('.sx-count')).toHaveText('3 listings');
    await expect(page.locator('.sx-listing')).toHaveCount(3);
    await expect(page.getByText(/Page \d+ of \d+/)).toHaveCount(0);
    expect(asked.length - before, 'the settled term is one request, not one per state change').toBe(1);
    expect(asked.at(-1)).toMatchObject({ action: 'market', market: { search: term, page: 1 } });
});

test('a save that lands while the market is loading is re-read, not reported to the player', async ({ page }) => {
    // Browsing no longer writes a save of its own, so its reply carries the
    // stored version — and an autosave that commits while the browse is in
    // flight leaves that reply describing an older character than the app
    // holds. The screen asks again rather than showing a refresh prompt.
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    const versions: number[] = [];
    let browses = 0;
    await page.route('**/api/festival/exchange', async route => {
        const body = route.request().postDataJSON() as { action?: string; market?: { page?: number } };
        const market = marketPage(body.market ?? {});
        if (body.action === 'market') return route.fulfill({ json: { ok: true, market } });
        // The second browse loses the race with a save; the third sees it.
        const version = ++browses === 2 ? 1 : runtime.currentVersion() + 9;
        versions.push(version);
        return route.fulfill({
            json: {
                ok: true, market, activity: [], inventory: [], creatorItems: [], recoveryErrors: [],
                character: save.character, _saveVersion: version,
            },
        });
    });

    await page.goto('/#/sunscarFestival', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Enter the Exchange', exact: true }).click();
    await expect(page.locator('.sx-listing')).toHaveCount(PAGE_SIZE);

    // A sale elsewhere refreshes the Exchange: that browse gets the stale reply.
    await page.evaluate(seller => window.dispatchEvent(new CustomEvent('sunscar-exchange:sold', { detail: { seller } })), 'auditninja');
    await expect.poll(() => browses).toBe(3);
    await expect(page.locator('.sx-error')).toHaveCount(0);
    await expect(page.locator('.sx-listing')).toHaveCount(PAGE_SIZE);
});

test('capacity guidance appears before submission and prepare-return revalidates a sold listing', async ({ page }) => {
    const save = uiAuditSave();
    save.character = { ...save.character, ryo: 500_000 };
    const runtime = await installUiAuditRuntime(page, save);
    const id = 'a'.repeat(32);
    const listing = {
        id, asset: { id: 'pet-offer', name: 'Dune Fox', kind: 'pet', category: 'pets', rarity: 'rare', description: 'A companion.', stats: [], level: 10 },
        price: 100, quantity: 1, currency: 'ryo', seller: 'miraa', sellerName: 'Miraa', state: 'active', createdAt: 1_700_000_000_000,
    };
    const actions: string[] = [];
    let readinessChecks = 0;
    await page.route('**/api/pet/sanctuary/list?*', route => route.fulfill({ json: {
        ok: true, items: [], total: 0, nextCursor: null, carriedCount: 0, carriedCapacity: 5,
    } }));
    await page.route('**/api/festival/exchange', async route => {
        const body = route.request().postDataJSON() as { action?: string; market?: Record<string, unknown> };
        actions.push(String(body.action));
        if (body.action === 'readiness') {
            readinessChecks += 1;
            if (readinessChecks === 2 || readinessChecks === 3) return route.abort('failed');
            const sold = readinessChecks > 3;
            return route.fulfill({ json: { ok: true, readiness: sold
                ? { listingId: id, observedAt: Date.now(), status: 'blocked', reasonCode: 'listing-unavailable', message: 'This listing is no longer available.', listing: { ...listing, state: 'sold', buyer: 'rival' } }
                : { listingId: id, observedAt: Date.now(), status: 'blocked', reasonCode: 'companion-capacity', message: 'Your companion roster is full. Move a companion to the Sanctuary before buying.', prepare: { screen: 'home', section: 'sanctuary', label: 'Manage companion roster' }, listing } } });
        }
        const query = { v: 2, page: 1, category: 'all', rarity: 'all', currency: 'all', sort: 'newest', search: '', affordable: false, ...(body.market ?? {}) };
        const market = { v: 2, query, page: 1, pageSize: PAGE_SIZE, pages: 1, total: 1, listings: [listing] };
        if (body.action === 'market') return route.fulfill({ json: { ok: true, market } });
        return route.fulfill({ json: { ok: true, market, activity: [], inventory: [], creatorItems: [], recoveryErrors: [], character: save.character, _saveVersion: runtime.currentVersion() } });
    });

    await page.goto('/#/sunscarFestival', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Enter the Exchange', exact: true }).click();
    await page.getByRole('button', { name: /Dune Fox/ }).click();
    await expect(page.getByText(/roster is full/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Buy for/ })).toBeDisabled();
    expect(actions).not.toContain('buy');

    await page.getByRole('button', { name: 'Manage companion roster' }).click();
    await expect(page.getByRole('heading', { name: 'Pet Home' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Companion Sanctuary' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to Exchange' })).toBeVisible();
    expect(actions).not.toContain('buy');

    await page.getByRole('button', { name: 'Return to Exchange' }).click();
    await expect(page.getByRole('button', { name: 'Retry listing check' })).toBeVisible();
    await expect(page.locator('.sx-success')).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry listing check' }).click();
    await expect.poll(() => readinessChecks).toBe(3);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText('This listing is no longer available.')).toBeVisible();
    await expect(page.getByText(/Status: Sold/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Buy for/ })).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(readinessChecks).toBe(4);
    expect(actions).not.toContain('buy');
});
