import { chromium, firefox, webkit, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { build } from '../../node_modules/esbuild/lib/main.js';

const output = resolve('output/chronicle-effects');
const requestedEngine = process.argv.find(arg => arg.startsWith('--browser='))?.split('=')[1];
const bundle = resolve(output, 'bundle');
await mkdir(output, { recursive: true });
await build({ entryPoints: ['src/chroniclepreview.tsx'], bundle: true, external: ['/chronicle/*', '/fonts/*'], outdir: bundle, format: 'esm', jsx: 'automatic', define: { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false', 'import.meta.env.MODE': '"development"' }, loader: { '.webp': 'file', '.png': 'file', '.jpg': 'file', '.svg': 'file', '.mp3': 'file' }, logLevel: 'warning' });
const roots = [bundle, resolve('public')];
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/chroniclepreview.css"><body style="margin:0;background:#05090d"><div id="root"></div><script type="module" src="/chroniclepreview.js"></script>');
    return;
  }
  const file = roots.map(root => resolve(root, pathname.slice(1))).find((file, index) => file.startsWith(roots[index] + sep) && existsSync(file));
  if (!file) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' })[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let currentPage;
const failures = [];
const results = [];
try {
  for (const [engine, width, height, motion] of [[chromium, 1366, 768, 'no-preference'], [chromium, 390, 844, 'reduce'], [chromium, 320, 568, 'reduce'], [chromium, 844, 390, 'no-preference'], [firefox, 1366, 768, 'no-preference'], [webkit, 390, 844, 'no-preference']].filter(([engine]) => !requestedEngine || engine.name() === requestedEngine)) {
    browser = await engine.launch({ headless: true });
    const engineName = engine.name();
    console.log(`Checking ${engineName} ${width}x${height}`);
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: motion });
    currentPage = page;
    page.on('pageerror', error => failures.push(`${engineName}: ${error.message}`));
    for (const [scenario, expected] of [['effect-pitfall', /was destroyed/], ['effect-block', /stops the attack/], ['effect-return', /returned to Keeper/], ['effect-stat', /ATK.*→/], ['effect-sweep', /was destroyed/]]) {
      await page.goto(`${origin}/?scenario=${scenario}&refresh=1`, { waitUntil: 'domcontentloaded' });
      const response = page.getByRole('group', { name: 'Snare response' });
      await expect(response).toBeVisible();
      const responseBounds = await response.boundingBox();
      expect(responseBounds.y).toBeGreaterThanOrEqual(0);
      expect(responseBounds.x + responseBounds.width).toBeLessThanOrEqual(width);
      expect(responseBounds.y + responseBounds.height).toBeLessThanOrEqual(height);
      await expect(response.locator('.chronicle-response-context')).toContainText(/paused before damage|summon has landed/);
      const activate = response.getByRole('button', { name: /^Activate / });
      await expect(activate.locator('small')).not.toBeEmpty();
      if (scenario === 'effect-pitfall') await page.screenshot({ path: resolve(output, `response-${engineName}-${width}x${height}.png`) });
      await activate.click();
      const callout = page.locator('.chronicle-effect-callout');
      await expect(callout).toContainText('Snare revealed');
      // A projection refresh arrives 150ms into the reveal. It must survive it.
      await page.waitForTimeout(450);
      await expect(callout).toBeVisible();
      const geometry = await callout.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scrollWidth: document.documentElement.scrollWidth, pointerEvents: getComputedStyle(el).pointerEvents, animation: getComputedStyle(el).animationName };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.bottom).toBeLessThanOrEqual(height);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
      expect(geometry.pointerEvents).toBe('none');
      if (motion === 'reduce') expect(geometry.animation).toBe('none');
      await expect(page.locator('.chronicle-effect-source')).toHaveCount(1);
      const nameFits = await page.locator('.chronicle-player-bar .chronicle-combatant__identity > strong').evaluate(el => el.scrollWidth <= el.clientWidth);
      expect(nameFits).toBe(true);
      const targetLabel = scenario === 'effect-block' ? 'ATTACK STOPPED' : scenario === 'effect-return' ? 'RETURNED' : scenario === 'effect-stat' ? /ATK −/ : 'DESTROYED';
      await expect(page.locator('.chronicle-effect-target b').first()).toContainText(targetLabel);
      if (scenario === 'effect-sweep') await expect(page.locator('.chronicle-effect-target')).toHaveCount(3);
      const labelContained = await page.locator('.chronicle-effect-target').first().evaluate(el => {
        const zone = el.getBoundingClientRect();
        const badge = el.querySelector('b').getBoundingClientRect();
        return badge.top >= zone.top - 1 && badge.bottom <= zone.bottom + 1;
      });
      expect(labelContained).toBe(true);
      if (scenario === 'effect-pitfall' || scenario === 'effect-block') await page.screenshot({ path: resolve(output, `${scenario}-${engineName}-${width}x${height}.png`) });
      if (scenario === 'effect-pitfall' && width < 600) {
        await expect(page.locator('.chronicle-effect-stage')).toHaveAttribute('data-phase', 'settle');
        await page.screenshot({ path: resolve(output, `settled-${engineName}-${width}x${height}.png`) });
      }
      await page.getByRole('button', { name: 'Last effect · Read recap' }).click();
      const recap = page.locator('.chronicle-recap-entry').first();
      await expect(recap).toContainText(expected);
      if (scenario === 'effect-pitfall') await page.screenshot({ path: resolve(output, `recap-${engineName}-${width}x${height}.png`) });
      results.push({ engine: engineName, width, height, motion, scenario, ...geometry });
    }
    await page.goto(`${origin}/?scenario=finishing-attack&refresh=1`);
    await page.getByRole('button', { name: /^Choose attacker in your Monster Zone 1/ }).click();
    await page.getByRole('button', { name: /^Direct Attack/ }).click();
    await expect(page.locator('.chronicle-effect-callout')).toContainText('Attack declared');
    await expect(page.locator('.chronicle-splash.outcome')).toHaveCount(0);
    await expect(page.locator('.chronicle-splash.outcome')).toContainText(/VICTORY/i);
    await expect(page.locator('.chronicle-effect-stage')).toHaveCount(0);
    await expect(page.locator('.chronicle-duelist-cut-in')).toHaveCount(0);
    results.push({ engine: engineName, width, height, scenario: 'final-impact-before-victory' });
    await page.goto(`${origin}/?scenario=response&refresh=1`);
    await page.getByRole('button', { name: 'Pass · Continue', exact: true }).click();
    await expect(page.locator('.chronicle-effect-callout')).toContainText('Response passed');
    await page.getByRole('button', { name: 'Last effect · Read recap' }).click();
    await expect(page.locator('.chronicle-recap-entry').first()).toContainText(/ATK.*→/);
    results.push({ engine: engineName, width, height, scenario: 'passed-jutsu-resolves' });
    if (engine === chromium && width === 1366) {
      await page.goto(`${origin}/?effect-fixture=1`);
      const fixture = JSON.parse(await page.getByTestId('fixture').textContent());
      await page.addInitScript(() => {
        for (const key of ['clanWarChallenge.v1', 'sectorWarCard.v1', 'cardClashFreePlay.v1']) sessionStorage.setItem(key, JSON.stringify({ matchId: 'effects-qa', playerName: 'Akari' }));
      });
      for (const host of ['clan', 'sector', 'pvp', 'ai', 'echoes', 'hall']) {
        console.log(`Checking host ${host}`);
        const requests = [];
        let resolved = false;
        await page.route('**/api/**', async route => {
          if (route.request().url().includes('sync-progression')) {
            await route.fulfill({ json: { granted: [], character: { name: 'Akari' }, _saveVersion: 1 } });
            return;
          }
          const body = route.request().postDataJSON();
          requests.push(body);
          if (body?.action === 'activate-trap') resolved = true;
          const session = { ...(resolved ? fixture.after : fixture.before), matchId: 'effects-qa' };
          await route.fulfill({ json: { ok: true, matchId: 'effects-qa', session, ...(resolved && ['hall', 'ai', 'echoes'].includes(host) ? { aiSteps: [session] } : {}) } });
        });
        await page.goto(`${origin}/?host=${host}`);
        await page.getByRole('button', { name: /^Activate Pitfall/ }).click();
        await expect.poll(() => requests.some(body => body?.action === 'activate-trap' && body.zoneIndex === 1)).toBe(true);
        await expect(page.locator('.chronicle-effect-callout')).toContainText('Pitfall Tag Array');
        await expect(page.locator('.chronicle-effect-target b')).toHaveText('DESTROYED');
        await page.getByRole('button', { name: 'Last effect · Read recap' }).click();
        await expect(page.locator('.chronicle-recap-entry').first()).toContainText('was destroyed');
        await expect(page.locator('.chronicle-error')).toHaveCount(0);
        await page.unroute('**/api/**');
        results.push({ engine: engineName, host, scenario: 'host-api-resolution' });
      }
      for (const host of ['hall', 'ai', 'pvp']) {
        let finished = false;
        await page.route('**/api/**', async route => {
          if (route.request().url().includes('sync-progression')) {
            await route.fulfill({ json: { granted: [], character: { name: 'Akari' }, _saveVersion: 1 } });
            return;
          }
          const body = route.request().postDataJSON();
          if (body?.action === 'attack') finished = true;
          const session = { ...(finished ? fixture.finished : fixture.finisher), matchId: 'effects-qa' };
          await route.fulfill({ json: { ok: true, matchId: 'effects-qa', session, ...(finished && host !== 'pvp' ? { aiSteps: [session] } : {}) } });
        });
        await page.goto(`${origin}/?host=${host}`);
        await page.getByRole('button', { name: /^Choose attacker in your Monster Zone 1/ }).click();
        await page.getByRole('button', { name: /^Direct Attack/ }).click();
        await expect(page.locator('.chronicle-effect-callout')).toContainText('Attack declared');
        await expect(page.locator('.chronicle-panel h2')).toHaveCount(0);
        await expect(page.locator('.chronicle-shell--duel-active')).toBeVisible();
        await expect(page.locator('.chronicle-splash.outcome')).toContainText(/VICTORY/i);
        await expect(page.locator('.chronicle-panel h2')).toContainText(/Victory|Seal Claimed/i);
        await expect(page.locator('.chronicle-effect-stage')).toHaveCount(0);
        await page.unroute('**/api/**');
        results.push({ engine: engineName, host, scenario: 'host-result-after-resolution' });
      }
    }
    await page.close();
    await browser.close();
    browser = null;
  }
  await writeFile(resolve(output, requestedEngine ? `results-${requestedEngine}.json` : 'results.json'), JSON.stringify({ results, failures }, null, 2));
  expect(failures).toEqual([]);
  console.log(`Passed ${results.length} browser scenarios; screenshots: ${output}`);
} catch (error) {
  await writeFile(resolve(output, `failure-${requestedEngine ?? 'all'}.json`), JSON.stringify({ results, failures, error: String(error) }, null, 2));
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: resolve(output, `failure-${requestedEngine ?? 'all'}.png`) }).catch(() => {});
    console.error((await currentPage.locator('body').innerText().catch(() => '')).slice(-3_000));
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
