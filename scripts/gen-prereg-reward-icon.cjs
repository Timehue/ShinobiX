// Composes the Play Console icon for the 1st Shinobi Reward Box from in-game art.
// Play shows product icons inside a hexagon mask and asks for no text, so all
// the art sits in the central safe circle and there is no badge.
// Usage: node scripts/gen-prereg-reward-icon.cjs [out.png] [hex-preview.png]
const path = require('path');
const sharp = require('sharp');
const repo = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(repo, 'docs', 'play-store', 'prereg-first-shinobi-box-icon-512.png');
const preview = process.argv[3];
const art = (p) => path.join(repo, 'shinobij.client', p);
const S = 512;
const C = 256;

const background = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#8a1a26"/>
      <stop offset="50%" stop-color="#3f0c16"/>
      <stop offset="100%" stop-color="#12060a"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="47%" r="34%">
      <stop offset="0%" stop-color="#ffbe5c" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#ffbe5c" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#glow)"/>
  ${Array.from({ length: 12 }, (_, i) => {
      const a = ((i * 30 + 15) * Math.PI) / 180;
      const x = C + Math.cos(a) * 260, y = C + Math.sin(a) * 260;
      return `<line x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#ffcf6e" stroke-opacity="0.09" stroke-width="20"/>`;
  }).join('')}
  <circle cx="${C}" cy="240" r="190" fill="url(#halo)"/>
</svg>`);

async function piece(file, size, rotate = 0) {
    let img = sharp(art(file)).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
    if (rotate) img = sharp(await img.png().toBuffer()).rotate(rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    return img.png().toBuffer();
}

function hexMask(pointyTop) {
    const r = S / 2;
    const pts = Array.from({ length: 6 }, (_, i) => {
        const a = ((i * 60 + (pointyTop ? 30 : 0)) * Math.PI) / 180;
        return `${(C + Math.cos(a) * r).toFixed(1)},${(C + Math.sin(a) * r).toFixed(1)}`;
    }).join(' ');
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><polygon points="${pts}" fill="#fff"/></svg>`);
}

(async () => {
    const crate = await piece('public/items/item-legendary-war-crate-v1.webp', 290);
    const shards = await piece('src/assets/clan-exchange/fateShardBundle.webp', 120);
    const ryo = await piece('public/ui/icon-96/ryo.webp', 96);
    const charm = await piece('public/ui/game-icons/bone-charm.webp', 112, -20);
    const charmMeta = await sharp(charm).metadata();
    const layer = await sharp({ create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([
            { input: crate, left: C - 145, top: 92 },
            { input: shards, left: 116, top: 296 },
            { input: ryo, left: C - 48, top: 330 },
            { input: charm, left: 300, top: 300 - Math.round((charmMeta.height - 112) / 2) },
        ])
        .png().toBuffer();
    // Shrink the whole group so Play's zoomed hexagon preview keeps a margin.
    const INNER = 452;
    const group = await sharp(layer).resize(INNER, INNER).png().toBuffer();
    const offset = Math.round((S - INNER) / 2);
    await sharp(background)
        .composite([{ input: group, left: offset, top: offset + 6 }])
        .ensureAlpha()
        .png({ compressionLevel: 9 })
        .toFile(out);
    const meta = await sharp(out).metadata();
    console.log(out, meta.width, meta.height, meta.channels, 'channels');

    // The pre-registration reward badge: the same art on a TRANSPARENT
    // background (Play asks for a transparent PNG), with a soft glow so the
    // dark crate still reads on a dark store theme.
    const badgeOut = path.join(path.dirname(out), 'prereg-first-shinobi-box-badge-512.png');
    const glow = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffbe5c" stop-opacity="0.55"/>
      <stop offset="55%" stop-color="#c2412d" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="#c2412d" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${C}" cy="${C}" r="${C - 6}" fill="url(#g)"/>
</svg>`);
    await sharp(glow)
        .composite([{ input: group, left: offset, top: offset + 6 }])
        .ensureAlpha()
        .png({ compressionLevel: 9 })
        .toFile(badgeOut);
    const badgeMeta = await sharp(badgeOut).metadata();
    console.log(badgeOut, badgeMeta.width, badgeMeta.height, badgeMeta.channels, 'channels');

    if (preview) {
        // Second tile: pointy hexagon after a 1.2x centre zoom, like Play's preview.
        const zoomed = await sharp(out).resize(614, 614).extract({ left: 51, top: 51, width: S, height: S }).png().toBuffer();
        const tiles = await Promise.all([[out, false], [zoomed, true]].map(([src, pointy]) => sharp(src)
            .composite([{ input: hexMask(pointy), blend: 'dest-in' }])
            .png().toBuffer()));
        await sharp({ create: { width: S * 2 + 30, height: S, channels: 4, background: '#ffffff' } })
            .composite([{ input: tiles[0], left: 0, top: 0 }, { input: tiles[1], left: S + 30, top: 0 }])
            .png().toFile(preview);
    }
})();
