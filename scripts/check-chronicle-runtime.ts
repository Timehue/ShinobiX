import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_PACK_TYPES } from '../api/card-clash/_pack.js';
import { CHRONICLE_CARD_CATALOG, CHRONICLE_TOKEN_CARDS } from '../shared/chronicle-duel.js';
import { CHRONICLE_PAINTED_ART, CHRONICLE_PAINTED_FIGURES } from '../shared/chronicle-painted-art.js';
import { packArtUrl } from '../shinobij.client/src/lib/card-pack-reveal.js';

// Verify the deployment artifact without depending on authoring masters or QA manifests.
const dist = fileURLToPath(new URL('../shinobij.client/dist/', import.meta.url));
const expected = new Set<string>();
function checkAsset(id: string, url: string, folder: 'cards' | 'figures' | 'packs') {
    const pathname = url.split('?')[0];
    if (!pathname.startsWith(`/chronicle/${folder}/`) || !pathname.endsWith('.webp')) {
        throw Error(`Invalid ${folder} asset for ${id}: ${url}`);
    }
    const file = statSync(path.join(dist, pathname), { throwIfNoEntry: false });
    if (!file?.isFile() || file.size === 0) throw Error(`Missing built asset for ${id}: ${url}`);
    if (expected.has(pathname)) throw Error(`Duplicate ${folder} asset for ${id}: ${url}`);
    expected.add(pathname);
}

for (const card of [...CHRONICLE_CARD_CATALOG, ...CHRONICLE_TOKEN_CARDS]) {
    const art = CHRONICLE_PAINTED_ART[card.id];
    if (!art || card.image !== art) throw Error(`Missing registered card face for ${card.id}`);
    checkAsset(card.id, art, 'cards');
    checkAsset(card.id, art.replace(/\.webp$/, '-512.webp'), 'cards');
    if (card.cardClass === 'monster') {
        const pair = CHRONICLE_PAINTED_FIGURES[card.id];
        if (!pair?.front || !pair.back) throw Error(`Missing battle figures for ${card.id}`);
        checkAsset(card.id, pair.front, 'figures');
        checkAsset(card.id, pair.back, 'figures');
    }
}
for (const type of CARD_PACK_TYPES) checkAsset(type, packArtUrl(type), 'packs');
for (const folder of ['cards', 'figures']) {
    for (const file of readdirSync(path.join(dist, 'chronicle', folder))) {
        if (!expected.has(`/chronicle/${folder}/${file}`)) throw Error(`Obsolete asset in deployment: ${folder}/${file}`);
    }
}
console.log(`chronicle-runtime: ${expected.size} built assets verified, including ${CARD_PACK_TYPES.length} pack wrappers.`);
