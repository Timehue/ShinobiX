import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const badgeDir = path.join(root, 'shinobij.client', 'public', 'badges');
const achievementFile = path.join(root, 'shinobij.client', 'src', 'constants', 'achievements.ts');
const clientAssets = path.join(root, 'shinobij.client', 'src', 'assets');

const source = await readFile(achievementFile, 'utf8');
const tableStart = source.indexOf('export const ACHIEVEMENTS');
const tableEnd = source.indexOf('\n];', tableStart);
if (tableStart < 0 || tableEnd < 0) throw new Error('Could not locate ACHIEVEMENTS table.');

const achievementIds = [...source.slice(tableStart, tableEnd).matchAll(/\bid:\s*"([a-z0-9-]+)"/g)]
    .map((match) => match[1]);
if (achievementIds.length === 0) throw new Error('No achievement ids discovered.');
if (new Set(achievementIds).size !== achievementIds.length) throw new Error('Duplicate achievement id discovered.');

// Badges are WebP, not PNG. They shipped as 165 uncompressed 256px PNGs
// (19.6 MB, 1.16 MB of it pulled just to open Profile) and were re-encoded at
// the SAME resolution for a 90% saving. A .png here would be a 404 at every
// render site, so this check follows the format rather than tolerating both.
const entries = await readdir(badgeDir, { withFileTypes: true });
const actualBadges = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.webp')).map((entry) => entry.name);
const actualNames = new Set(actualBadges);
const expectedNames = achievementIds.map((id) => `${id}.webp`);
const missing = expectedNames.filter((name) => !actualNames.has(name));
if (missing.length > 0) throw new Error(`Missing achievement badges: ${missing.join(', ')}`);

const strayPngs = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.png')).map((entry) => entry.name);
if (strayPngs.length > 0) throw new Error(`Badge art must be WebP; found stray PNGs: ${strayPngs.join(', ')}`);

const invalid = [];
for (const filename of actualBadges) {
    const full = path.join(badgeDir, filename);
    try {
        const metadata = await sharp(full).metadata();
        if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
            invalid.push(`${filename} (not a dimensioned WebP)`);
            continue;
        }
        if (metadata.width !== metadata.height) invalid.push(`${filename} (${metadata.width}x${metadata.height}, not square)`);
    } catch (error) {
        invalid.push(`${filename} (${error instanceof Error ? error.message : String(error)})`);
    }
}
if (invalid.length > 0) throw new Error(`Invalid badge assets:\n${invalid.join('\n')}`);

const petHomeAssets = [
    'pet-home/home-hero.webp', 'pet-home/breeding-barn.webp', 'pet-home/hatch-sanctum.webp', 'pet-home/companion-sanctuary.webp',
    ...['fire', 'water', 'wind', 'lightning', 'earth'].flatMap((element) => [
        `pet-home/egg-${element}.webp`, `pet-home/crest-${element}.webp`,
    ]),
    'pet-home/hatch-rare-overlay.webp', 'pet-home/hatch-chromatic-overlay.webp',
    'facilities/home.webp',
    ...['frostfang', 'stormveil', 'ashen-leaf', 'moonshadow'].map((village) => `facilities/thumbs/${village}/home.webp`),
];
const invalidPetHome = [];
for (const relative of petHomeAssets) {
    const full = path.join(clientAssets, relative);
    try {
        const metadata = await sharp(full).metadata();
        if (metadata.format !== 'webp' || !metadata.width || !metadata.height) invalidPetHome.push(`${relative} (not a dimensioned WebP)`);
        if ((relative.includes('/egg-') || relative.endsWith('/hatch-sanctum.webp')) && metadata.width !== metadata.height) invalidPetHome.push(`${relative} (must be square)`);
    } catch (error) {
        invalidPetHome.push(`${relative} (${error instanceof Error ? error.message : String(error)})`);
    }
}
if (invalidPetHome.length) throw new Error(`Invalid Pet Home assets:\n${invalidPetHome.join('\n')}`);

console.log(`release-assets: ${expectedNames.length} achievement references present; ${actualBadges.length} badge WebPs and ${petHomeAssets.length} Pet Home WebPs verified.`);
