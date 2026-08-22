import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { starterItems } from './data/starter-items';
import { ACHIEVEMENTS } from './constants/achievements';

/** WebP dimensions straight from the header — no image dependency in the unit suite. */
function sizeOfWebp(file: string): { width: number; height: number } | null {
    const b = readFileSync(file);
    if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
    const kind = b.toString('ascii', 12, 16);
    // VP8X (extended, what these cutouts use): 24-bit canvas size minus one.
    if (kind === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    if (kind === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    return null;
}

/*
 * The item catalog carries ~10 MB of 512px artwork for thumbnails that render at
 * 64px. The shop paints every item of every slot group in one pass — no
 * pagination, no virtualization — and the backpack grid is unbounded, so an
 * eagerly-loaded catalog turns opening either screen into a multi-megabyte
 * fetch on a phone. These guard the two things that keep that in check.
 */

const clientRoot = join(process.cwd(), 'shinobij.client');
const read = (...parts: string[]) => readFileSync(join(clientRoot, ...parts), 'utf8');

/** The whole `<img ... />` element containing `needle`, comments and all. */
function imgTagContaining(source: string, needle: string, label: string): string {
    const at = source.indexOf(needle);
    assert.ok(at > 0, `${label}: "${needle}" is gone; re-anchor this assertion`);
    const open = source.lastIndexOf('<img', at);
    const close = source.indexOf('/>', at);
    assert.ok(open >= 0 && close > open, `${label}: could not bracket the <img> element`);
    return source.slice(open, close);
}

test('the shop item thumbnail defers its catalog artwork', () => {
    const tag = imgTagContaining(read('src', 'components', 'Shop.tsx'), 'className="shop-item-thumb"', 'shop');
    assert.ok(/loading="lazy"/.test(tag), 'the shop thumbnail must carry loading="lazy"');
    assert.ok(/decoding="async"/.test(tag), 'the shop thumbnail must carry decoding="async"');
});

test('the backpack grid defers its catalog artwork', () => {
    const inventory = read('src', 'screens', 'Inventory.tsx');
    assert.ok(inventory.includes('className="backpack-item-art"'), 'the backpack art wrapper moved; re-anchor this assertion');
    const tag = imgTagContaining(inventory, 'src={item.image}', 'backpack');
    assert.ok(/loading="lazy"/.test(tag), 'the backpack thumbnail must carry loading="lazy"');
    assert.ok(/decoding="async"/.test(tag), 'the backpack thumbnail must carry decoding="async"');
});

test('catalog artwork stays within its rendered size budget', () => {
    // Rendered at 64px in the shop/backpack grids and 132px in the detail popup,
    // so 320px covers the largest surface even at 2x DPR. The catalog shipped at
    // 512px, which put ~11 MB behind two screens; scripts/downscale-item-artwork.mjs
    // brought it to ~4 MB. This is the ratchet — a 512px drop-in fails here rather
    // than quietly restoring the payload.
    const dir = join(clientRoot, 'public', 'items');
    const files = readdirSync(dir).filter((f) => f.endsWith('.webp'));
    assert.ok(files.length > 100, 'the item artwork directory looks wrong');

    const oversized = files
        .map((f) => ({ f, size: sizeOfWebp(join(dir, f)) }))
        .filter((x) => x.size && (x.size.width > 320 || x.size.height > 320))
        .map((x) => `${x.f} ${x.size!.width}x${x.size!.height}`);
    assert.deepEqual(oversized, [], 'these item images exceed the 320px render budget');

    const totalBytes = files.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
    const budget = 6 * 1024 * 1024;
    assert.ok(
        totalBytes <= budget,
        `item artwork totals ${(totalBytes / 1048576).toFixed(2)} MB, over the ${budget / 1048576} MB budget`,
    );
});

test('badge art ships as WebP, never PNG', () => {
    // The set shipped as 165 uncompressed 256px PNGs averaging 121 KB — 19.6 MB,
    // 1.16 MB of it pulled just to open Profile, where achievements render as a
    // grid. Re-encoding to WebP at the SAME resolution cut that by 90% with no
    // quality change. scripts/slice-badges.mjs emits .webp now; this fails if a
    // regenerated sheet reintroduces PNGs, which would 404 every render site.
    const dir = join(clientRoot, 'public', 'badges');
    const stray = readdirSync(dir).filter((f) => /\.png$/i.test(f));
    assert.deepEqual(stray, [], 'badge art must be WebP — .png files here are 404s waiting to happen');

    const webp = readdirSync(dir).filter((f) => f.endsWith('.webp'));
    assert.ok(webp.length >= 165, `expected the full badge set, found ${webp.length}`);

    const totalBytes = webp.reduce((sum, f) => sum + statSync(join(dir, f)).size, 0);
    const budget = 4 * 1024 * 1024;
    assert.ok(
        totalBytes <= budget,
        `badge art totals ${(totalBytes / 1048576).toFixed(2)} MB, over the ${budget / 1048576} MB budget`,
    );
});

test('every achievement resolves to badge art that ships', () => {
    const dir = join(clientRoot, 'public', 'badges');
    const missing = ACHIEVEMENTS
        .filter((achievement) => {
            try { return statSync(join(dir, `${achievement.id}.webp`)).size === 0; } catch { return true; }
        })
        .map((achievement) => achievement.id);
    assert.deepEqual(missing, [], 'these achievements have no badge art');
});

test('every purchasable item resolves to artwork that ships', () => {
    const purchasable = starterItems.filter((item) => Number(item.cost) > 0);
    const missing = purchasable.filter((item) => !item.image).map((item) => item.id);
    assert.deepEqual(missing, [], 'these purchasable items have no artwork');

    const broken = purchasable
        .filter((item) => item.image?.startsWith('/items/'))
        .filter((item) => {
            try {
                return statSync(join(clientRoot, 'public', item.image as string)).size === 0;
            } catch {
                return true;
            }
        })
        .map((item) => `${item.id} -> ${item.image}`);
    assert.deepEqual(broken, [], 'these item artwork paths do not resolve to a shipped file');
});
