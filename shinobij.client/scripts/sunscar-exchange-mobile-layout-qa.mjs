import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.env.SUNSCAR_QA_URL || 'http://127.0.0.1:5198';
const out = new URL('../../.tmp/sunscar-exchange-mobile-layout/', import.meta.url);
await mkdir(out, { recursive: true });

for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await type.launch({ headless: true });
    try {
        for (const width of [320, 390, 430]) {
            const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
            await page.request.post(`${base}/__qa/reset`);
            await page.goto(`${base}/sunscar-exchange-qa.html`);
            await page.getByRole('button', { name: 'Enter the Exchange' }).waitFor();
            await page.locator('.sunscar-exchange-entrance').evaluate(entrance => entrance.scrollIntoView());
            assert.ok(await page.evaluate(() => scrollY > 0), `${name} ${width}: entrance is below the fold`);
            await page.getByRole('button', { name: 'Enter the Exchange' }).click();
            await page.locator('.sx-categories > button').first().waitFor();
            assert.equal(await page.evaluate(() => scrollY), 0, `${name} ${width}: Exchange opens at the top`);
            const layout = await page.locator('.sx-hall').evaluate(hall => {
                const box = e => e.getBoundingClientRect();
                const categories = hall.querySelector('.sx-categories');
                const chips = [...categories.querySelectorAll(':scope > button')];
                const tabs = [...hall.querySelectorAll('.sx-tabs > button')];
                const selects = [...hall.querySelectorAll('.sx-filters select')];
                const chipOverlap = chips.some((chip, i) => i && box(chip).left < box(chips[i - 1]).right - 1);
                const tabOverflow = tabs.some(tab => box(tab).left < box(hall).left - 1 || box(tab).right > box(hall).right + 1);
                const filterOverflow = selects.some(select => box(select).left < box(hall).left - 1 || box(select).right > box(hall).right + 1);
                return {
                    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
                    chipOverlap, tabOverflow, filterOverflow,
                    categoryScrollable: categories.scrollWidth > categories.clientWidth,
                    currencyWidth: box(hall.querySelector('select[aria-label="Listing currency"]')).width,
                };
            });
            assert.equal(layout.pageOverflow, false, `${name} ${width}: document overflow`);
            assert.equal(layout.chipOverlap, false, `${name} ${width}: overlapping categories`);
            assert.equal(layout.tabOverflow, false, `${name} ${width}: clipped section tabs`);
            assert.equal(layout.filterOverflow, false, `${name} ${width}: clipped filters`);
            assert.equal(layout.categoryScrollable, true, `${name} ${width}: category rail should scroll`);
            if (width > 360) assert.ok(layout.currencyWidth >= 140, `${name} ${width}: currency label needs room`);
            await page.locator('.sx-categories').getByRole('button', { name: 'Materials', exact: true }).click();
            assert.equal(await page.locator('.sx-categories').getByRole('button', { name: 'Materials', exact: true }).getAttribute('aria-pressed'), 'true');
            await page.screenshot({ path: fileURLToPath(new URL(`${name}-${width}.png`, out)) });
            console.log(name, width, JSON.stringify(layout));
            await page.close();
        }
    } finally {
        await browser.close();
    }
}
