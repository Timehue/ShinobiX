import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const output = '../tmp/vn-reader-pass';
await mkdir(output, { recursive: true });
const inventory = JSON.parse(await readFile(`${output}/inventory.json`, 'utf8'));
const smoke = process.argv.includes('--smoke');
const reports = [], failures = [];
const cases = [];
const dungeonRows = inventory.rows.filter(row => /^(builtin-hidden-dungeon|craft-dungeon-[a-z]+)$/.test(row.eventId));
for (const [width, height] of [[390, 844], [320, 640], [844, 390], [1440, 900]]) {
    for (const row of dungeonRows) cases.push({ row, width, height, dungeon: true,
        avatar: ['none', 'square', 'tall'][row.pageIndex], lineIndex: 0 });
}
if (!smoke) for (const [width, height] of [[390, 844], [1440, 900]]) {
    for (const row of inventory.rows) cases.push({ row, width, height, avatar: 'square', lineIndex: 0 });
}
const browser = await chromium.launch({ headless: true });
let next = 0;
try {
    await Promise.all(Array.from({ length: smoke ? 1 : 4 }, async (_, worker) => {
        const context = await browser.newContext({ reducedMotion: 'reduce' });
        await context.addInitScript(() => {
            localStorage.setItem('vnTextSpeed.v1', 'instant');
            localStorage.setItem('pet-music-muted', '1');
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(120000);
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        let ready = false;
        while (next < cases.length) {
            const c = cases[next++], { row, width, height } = c;
            const eventKey = row.key.split('/page:')[0];
            const name = `${c.dungeon ? 'dungeon' : 'catalog'}-${eventKey}-p${row.pageIndex}-${width}`;
            errors.length = 0;
            try {
                await page.setViewportSize({ width, height });
                const query = '?' + new URLSearchParams({ preview: 'vn', event: eventKey,
                    page: String(row.pageIndex), line: String(c.lineIndex), avatar: c.avatar,
                    ...(c.dungeon ? { reader: 'dungeon' } : {}),
                    ...(row.eventConditions?.replay ? { replay: '1' } : {}),
                });
                if (!ready) { await page.goto(`http://127.0.0.1:4173/${query}`, { waitUntil: 'domcontentloaded' }); ready = true; }
                else await page.evaluate(query => { history.pushState({}, '', query); dispatchEvent(new PopStateEvent('popstate')); }, query);
                await page.waitForFunction(query => document.querySelector('[data-vn-preview-route]')?.getAttribute('data-vn-preview-route') === query, query);
                await page.locator('.cvn-root').waitFor({ timeout: 90000 });
                await page.waitForFunction(() => document.querySelector('.cvn-dialogue-text')?.textContent.trim()
                    && [...document.querySelectorAll('.cvn-root img')].every(i => i.complete && i.naturalWidth));
                await page.locator('.cvn-dialogue-footer button').first().waitFor();
                const result = await page.evaluate(async () => {
                    const root = document.querySelector('.cvn-root'), bg = root.querySelector('.cvn-backdrop');
                    const background = getComputedStyle(bg).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
                    if (!background) throw new Error('Missing full-screen scene background');
                    const image = new Image(); image.src = background; await image.decode();
                    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
                    return { background: new URL(background).pathname, root: rect(root), backgroundRect: rect(bg),
                        dialogue: rect(root.querySelector('.cvn-dialogue-shell')),
                        speaker: rect(root.querySelector('.cvn-speaker')), text: rect(root.querySelector('.cvn-dialogue-text')),
                        actors: [...root.querySelectorAll('.cvn-actor')].map(el => ({ player: el.classList.contains('is-player'), ...rect(el) })),
                        controls: [...root.querySelectorAll('.cvn-dialogue-footer button')].map(el => ({ text: el.textContent, ...rect(el) })),
                        overflow: document.documentElement.scrollWidth - innerWidth,
                        legacy: document.querySelectorAll('.vn-stage, .vn-character, .relic-dungeon-command').length };
                });
                assert.equal(result.background, row.presentations[c.lineIndex].background.split(/[?#]/)[0], `${name}: correct scene`);
                assert.equal(result.legacy, 0, `${name}: bypassed cinematic reader`);
                assert.ok(result.root.width >= width - 2 && result.root.height >= height - 2, `${name}: reader is not full-screen`);
                assert.ok(result.backgroundRect.height >= height - 2, `${name}: background only fills a header`);
                assert.ok(result.overflow <= 1, `${name}: horizontal overflow`);
                assert.ok(result.dialogue.x >= -1 && result.dialogue.right <= width + 1 && result.dialogue.bottom <= height + 1, `${name}: dialogue clipped`);
                assert.ok(result.speaker.bottom <= result.text.y + 1, `${name}: speaker badge overlaps dialogue`);
                for (const control of result.controls) assert.ok(control.x >= -1 && control.right <= width + 1 && control.bottom <= height + 1, `${name}: clipped ${control.text}`);
                if (c.dungeon) {
                    assert.ok(result.actors.some(actor => !actor.player && actor.height > height * .2), `${name}: tiny Warden portrait`);
                    assert.equal(result.actors.some(actor => actor.player), c.avatar !== 'none', `${name}: empty avatar placeholder`);
                    assert.equal(await page.getByRole('button', { name: 'Skip', exact: true }).count(), 0);
                    await page.getByRole('button', { name: 'Leave', exact: true }).waitFor();
                }
                assert.deepEqual(errors, [], `${name}: runtime errors`);
                if (c.dungeon || (width === 390 && row.pageIndex === 0)) await page.screenshot({ path: `${output}/${name.replace(/[:/]/g, '-')}.png` });
                reports.push({ name, ...result });
                if (reports.length % 50 === 0 || smoke) console.log(`${reports.length}/${cases.length} ${name}`);
            } catch (error) {
                failures.push({ name, error: String(error) });
                await page.screenshot({ path: `${output}/failed-${worker}-${failures.length}.png` }).catch(() => {});
                console.error(`${name}: ${error}`);
                if (failures.length >= 8) { next = cases.length; break; }
            }
        }
        await context.close();
    }));
} finally {
    await browser.close();
    await writeFile(`${output}/${smoke ? 'dungeon' : 'all-readers'}-report.json`, JSON.stringify({ expected: cases.length, passed: reports.length, failures, reports }, null, 2));
}
assert.deepEqual(failures, []);
assert.equal(reports.length, cases.length);
console.log(`Passed ${reports.length} reader layout cases`);
