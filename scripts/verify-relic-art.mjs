// node --import tsx scripts/verify-relic-art.mjs
// Asset-only browser verification; does not build or start the game server.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { RELIC_ROSTER } = require('../shared/relics.ts');
const { chromium, firefox, webkit } = require('../shinobij.client/node_modules/playwright');
const output = resolve('docs/audits/relic-roster-2026-10-02');
await mkdir(output, { recursive: true });
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const assets = [];
const cards = [];
for (const relic of RELIC_ROSTER) {
    const path = `shinobij.client/public${relic.image}`;
    const bytes = await readFile(path);
    const metadata = await sharp(bytes).metadata();
    assets.push({ id: relic.id, name: relic.name, path, bytes: bytes.length,
        width: metadata.width, height: metadata.height, alpha: metadata.hasAlpha,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    const bonus = Object.entries(relic.bonuses).map(([key, value]) => `+${value}% ${key === 'pveDamagePercent' ? 'all' : key.replace('pve', '').replace('DamagePercent', '')} PvE`).join(', ');
    cards.push(`<article><img alt="${escape(relic.name)}" src="data:image/webp;base64,${bytes.toString('base64')}"><h2>${escape(relic.name)}</h2><p>${escape(bonus)}</p><small>Tier ${relic.tier} · Level ${relic.levelReq}</small></article>`);
}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>All 20 relics — artwork audit</title><style>
*{box-sizing:border-box}body{margin:0;padding:32px;background:#0b1420;color:#e9edf2;font:15px Arial,sans-serif}h1{font:32px Georgia,serif;color:#e4c381;margin:0 0 8px}header{margin-bottom:24px}header p{color:#aebdcd;margin:0}main{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}article{min-height:232px;padding:12px;background:#142232;border:1px solid #354554;border-radius:10px;text-align:center}img{display:block;width:156px;height:156px;object-fit:contain;margin:auto}h2{font:17px Georgia,serif;color:#efddaf;margin:9px 0 5px}p{margin:0 0 5px}small{color:#95a9bd}footer{margin-top:20px;color:#95a9bd}
</style><header><h1>Relic collection</h1><p>20 equippable relics · PvE damage only · Canonical artwork verification</p></header><main>${cards.join('')}</main><footer>Four equal village rewards. Four top offense relics, each +14%. Artwork copied from the exact files the game references.</footer></html>`;
await writeFile(resolve(output, 'relic-art-gallery.html'), html);
const browsers = [];
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1240, height: 1400 }, reducedMotion: 'reduce' });
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        const decoded = await page.evaluate(async () => Promise.all([...document.images].map(async image => {
            try { await image.decode(); return { name: image.alt, width: image.naturalWidth, height: image.naturalHeight }; }
            catch { return { name: image.alt, width: 0, height: 0 }; }
        })));
        const broken = decoded.filter(image => image.width < 96 || image.height < 96);
        browsers.push({ name, decoded: decoded.length, broken });
        if (name === 'chromium') await page.screenshot({ path: resolve(output, 'relic-art-gallery.png'), fullPage: true });
        console.log(JSON.stringify(browsers.at(-1)));
    } finally { await browser.close(); }
}
await writeFile(resolve(output, 'relic-art-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), assets, browsers }, null, 2) + '\n');
if (assets.length !== 20 || browsers.some(browser => browser.decoded !== 20 || browser.broken.length)) process.exitCode = 1;
