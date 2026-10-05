// Generate the Android launcher icons and splash art from the website's icons,
// at the sizes the old TWA shipped (scripts/sync-android-qa.mjs), so the
// upgrade does not change what players see on their home screen.
//
// Usage (from the repo root): node mobile/tools/gen-android-assets.mjs
// Re-run after changing shinobij.client/public/icon-512.png or
// icon-maskable-512.png (themselves made by scripts/gen-pwa-icons.mjs).
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const icon = join(repo, 'shinobij.client/public/icon-512.png');
const maskable = join(repo, 'shinobij.client/public/icon-maskable-512.png');
const res = join(repo, 'mobile/android/app/src/main/res');

const densities = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];

async function png(source, dp, factor, target) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await sharp(source).resize(Math.round(dp * factor)).png().toBuffer());
}

async function splashWebp(source, dp, factor, target) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await sharp(source)
        .resize(Math.round(dp * factor))
        .webp({ quality: 95, alphaQuality: 100, effort: 6 })
        .toBuffer());
}

for (const [density, factor] of densities) {
    // Legacy launcher icon, and the full-bleed art behind the adaptive icon.
    await png(icon, 48, factor, join(res, `mipmap-${density}/ic_launcher.png`));
    await png(maskable, 108, factor, join(res, `mipmap-${density}/ic_maskable.png`));
    // Android 12+ system splash: 288dp, shown through a 192dp circle. Keep
    // lossless transparency while using WebP to avoid packaging multi-megabyte PNGs.
    const splashPng = join(res, `drawable-${density}/splash_icon.png`);
    await splashWebp(maskable, 288, factor, join(res, `drawable-${density}/splash_icon.webp`));
    await rm(splashPng, { force: true });
    // Android 11 and older: the launch window's centred mark.
    await png(icon, 160, factor, join(res, `drawable-${density}/launch_mark.png`));
}

await mkdir(join(res, 'mipmap-anydpi-v26'), { recursive: true });
await writeFile(join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_maskable" />
    <foreground android:drawable="@android:color/transparent" />
</adaptive-icon>
`);

// The in-app splash (lib/src/shell_page.dart) draws the same art as the
// Android 12+ system splash. Use the same high quality WebP encoding so the
// matching Flutter asset does not reintroduce the large PNG into the bundle.
await mkdir(join(repo, 'mobile/assets'), { recursive: true });
const splashMark = join(repo, 'mobile/assets/splash_mark.png');
await writeFile(join(repo, 'mobile/assets/splash_mark.webp'), await sharp(maskable)
    .webp({ quality: 95, alphaQuality: 100, effort: 6 })
    .toBuffer());
await rm(splashMark, { force: true });

console.log('Android launcher icons and splash art regenerated.');
