import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { STRONGHOLD_ROOMS } from '../../shared/sector-stronghold.ts';

const source = resolve(process.argv[2] ?? '.tmp/room-map-final-review');
const output = resolve(process.argv[3] ?? '../docs/stronghold/underground-review');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
    for (let group = 0; group < 3; group++) {
        const cards = await Promise.all(STRONGHOLD_ROOMS.slice(group * 4, group * 4 + 4).map(async room =>
            `<figure><figcaption>${room.id + 1}. ${room.name}</figcaption><img src="data:image/png;base64,${(await readFile(`${source}/chromium-room-${room.id}.png`)).toString('base64')}"></figure>`));
        await page.setContent(`<html><style>html{background:#080d14;color:#d6e3ed;font:18px system-ui}body{margin:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}figcaption{padding:8px 0}img{display:block;width:100%;height:auto;border:1px solid #344955;box-sizing:border-box}</style><body>${cards.join('')}</body></html>`);
        await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
        await page.screenshot({ path: `${output}/sector-style-rooms-${group + 1}.png`, fullPage: true });
    }
} finally { await browser.close(); }
