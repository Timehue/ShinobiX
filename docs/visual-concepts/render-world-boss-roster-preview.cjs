const fs = require('node:fs');
const path = require('node:path');
const sharp = require('C:/Users/Tyler R/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');

const root = path.resolve(__dirname, '../..');
const publicDir = path.join(root, 'shinobij.client/public');
const outputPath = path.join(__dirname, 'world-boss-roster-map-preview.png');

async function pngData(filePath, options = {}) {
  const result = await sharp(filePath).resize(options).png().toBuffer();
  return result.toString('base64');
}

async function firstFrame(fileName) {
  const filePath = path.join(publicDir, 'world-boss', fileName);
  const image = sharp(filePath);
  const metadata = await image.metadata();
  return image
    .extract({ left: 0, top: 0, width: Math.floor(metadata.width / 4), height: metadata.height })
    .resize(84, 112, { fit: 'fill' })
    .png()
    .toBuffer();
}

async function main() {
  const [wolf, bull, minotaur, forest, snow, cinder] = await Promise.all([
    firstFrame('hollow-beast-walk-v1.webp'),
    firstFrame('hollow-gate-bull-walk-v1.webp'),
    firstFrame('donkaku-walk-v1.webp'),
    pngData(path.join(publicDir, 'sector-map/world-terrain/forest.webp'), { width: 1000, height: 580, fit: 'cover' }),
    pngData(path.join(publicDir, 'sector-map/world-terrain/snow.webp'), { width: 600, height: 420, fit: 'cover' }),
    pngData(path.join(publicDir, 'sector-map/world-terrain/cinder.webp'), { width: 720, height: 430, fit: 'cover' }),
  ]);

  const bossImage = (data, x, y, filter) => `<image href="data:image/png;base64,${data.toString('base64')}" x="${x}" y="${y}" width="84" height="112" filter="url(#${filter})"/>`;
  const player = (x, y) => `<g transform="translate(${x} ${y})"><ellipse cx="0" cy="16" rx="13" ry="4" fill="#061426" opacity=".52"/><circle cx="0" cy="-2" r="5" fill="#e9d0a4" stroke="#fff0cf" stroke-width="1"/><path d="M-7 5 Q0 0 7 5 L9 15 Q0 19 -9 15Z" fill="#55d4c2" stroke="#d4fff6" stroke-width="1.5"/><path d="M-5 14L-8 22M5 14L8 22" stroke="#d9e8f2" stroke-width="2.6" stroke-linecap="round"/></g>`;
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <defs>
    <radialGradient id="bg" cx="52%" cy="40%"><stop stop-color="#142a46"/><stop offset=".58" stop-color="#09172a"/><stop offset="1" stop-color="#06101f"/></radialGradient>
    <linearGradient id="ocean" x2="1" y2="1"><stop stop-color="#0e5b96"/><stop offset=".52" stop-color="#0a3d73"/><stop offset="1" stop-color="#092851"/></linearGradient>
    <linearGradient id="landTint" x2="1" y2=".8"><stop stop-color="#174c42" stop-opacity=".42"/><stop offset=".55" stop-color="#183b4d" stop-opacity=".14"/><stop offset="1" stop-color="#6f3a32" stop-opacity=".34"/></linearGradient>
    <linearGradient id="card" x2="1"><stop stop-color="#132844"/><stop offset="1" stop-color="#0c1b2e"/></linearGradient>
    <pattern id="grid" width="160" height="120" patternUnits="userSpaceOnUse"><path d="M160 0H0V120" fill="none" stroke="#e0f1ff" stroke-opacity=".11" stroke-width="1"/></pattern>
    <pattern id="stars" width="287" height="203" patternUnits="userSpaceOnUse"><circle cx="18" cy="34" r="1.5" fill="#eaf6ff" opacity=".66"/><circle cx="199" cy="24" r="1.1" fill="#d7efff" opacity=".7"/><circle cx="252" cy="161" r="1.4" fill="#fff" opacity=".55"/><circle cx="89" cy="129" r="1" fill="#8fd4f6" opacity=".52"/></pattern>
    <clipPath id="panelClip"><rect x="60" y="164" width="1480" height="600" rx="20"/></clipPath>
    <clipPath id="landClip"><path d="M105 105 250 62 404 82 528 42 681 76 794 45 931 91 1076 66 1202 112 1332 168 1371 243 1341 321 1392 399 1292 482 1161 480 1050 539 916 516 776 552 635 510 518 548 378 505 268 520 157 442 117 345 74 258 100 170Z"/></clipPath>
    <clipPath id="snowClip"><path d="M830 43 931 91 1076 66 1202 112 1332 168 1371 243 1280 294 1140 281 1023 229 900 229Z"/></clipPath>
    <clipPath id="cinderClip"><path d="M837 322 948 361 1050 325 1161 358 1341 321 1392 399 1292 482 1161 480 1050 539 916 516 818 466Z"/></clipPath>
    <filter id="glowTeal" x="-45%" y="-30%" width="190%" height="170%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#43e8d0" flood-opacity=".82"/><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".7"/></filter>
    <filter id="glowViolet" x="-45%" y="-30%" width="190%" height="170%"><feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#aa70ff" flood-opacity=".84"/><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".76"/></filter>
    <filter id="glowRed" x="-45%" y="-30%" width="190%" height="170%"><feDropShadow dx="0" dy="0" stdDeviation="4" flood-color="#fff7f1" flood-opacity=".94"/><feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#ff6172" flood-opacity=".68"/><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity=".7"/></filter>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity=".34"/></filter>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <text x="55" y="54" fill="#20cbb1" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="800" letter-spacing="2.4">WORLD BOSS ROSTER</text>
  <rect x="1372" y="32" width="172" height="31" rx="16" fill="#192438" stroke="#96753d"/>
  <text x="1458" y="52" fill="#e7c879" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="800" letter-spacing="1.3">IN-GAME MAP CONCEPT</text>
  <text x="55" y="118" fill="#f1f6fc" font-family="Segoe UI,Arial,sans-serif" font-size="43" font-weight="750" letter-spacing="-1.2">Three threats. One living world.</text>
  <text x="57" y="147" fill="#a9bfd6" font-family="Segoe UI,Arial,sans-serif" font-size="16">Actual walk sprites shown at the game's boss-marker scale, anchored to world sectors.</text>
  <g filter="url(#shadow)"><rect x="60" y="164" width="1480" height="600" rx="20" fill="url(#ocean)" stroke="#365370" stroke-width="2"/></g>
  <g clip-path="url(#panelClip)">
    <rect x="60" y="164" width="1480" height="600" fill="url(#stars)"/>
    <g transform="translate(60 164)">
      <path d="M105 105 250 62 404 82 528 42 681 76 794 45 931 91 1076 66 1202 112 1332 168 1371 243 1341 321 1392 399 1292 482 1161 480 1050 539 916 516 776 552 635 510 518 548 378 505 268 520 157 442 117 345 74 258 100 170Z" fill="#355d49" stroke="#8bc29a" stroke-opacity=".32" stroke-width="3"/>
      <g clip-path="url(#landClip)">
        <image href="data:image/png;base64,${forest}" x="52" y="6" width="1390" height="570" preserveAspectRatio="xMidYMid slice" opacity=".51"/>
        <image href="data:image/png;base64,${snow}" x="785" y="20" width="640" height="320" preserveAspectRatio="xMidYMid slice" opacity=".63" clip-path="url(#snowClip)"/>
        <image href="data:image/png;base64,${cinder}" x="785" y="284" width="650" height="300" preserveAspectRatio="xMidYMid slice" opacity=".50" clip-path="url(#cinderClip)"/>
        <rect x="0" y="0" width="1480" height="590" fill="url(#landTint)"/>
        <rect x="0" y="0" width="1480" height="590" fill="url(#grid)" opacity=".7"/>
        <path d="M112 430 C245 348 310 458 405 416 S606 326 735 413 S930 465 1034 355 S1210 327 1332 370" fill="none" stroke="#ffd37c" stroke-opacity=".86" stroke-width="3" stroke-dasharray="3 11" stroke-linecap="round"/>
        <path d="M192 212 C378 132 535 156 692 225 S960 271 1121 205" fill="none" stroke="#e3f0fa" stroke-opacity=".32" stroke-width="1.5" stroke-dasharray="7 10"/>
        <path d="M260 92 1215 478M378 492 1196 124" stroke="#e1effa" stroke-opacity=".13" stroke-width="1"/>
      </g>
      <text x="42" y="38" fill="#dceafa" font-family="Segoe UI,Arial,sans-serif" font-size="12" font-weight="800" text-anchor="middle">N</text><path d="M42 46 37 59 42 56 47 59Z" fill="#f3d183"/>
      <g fill="#e8f4ea" font-family="Segoe UI,Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="2.2" opacity=".82" filter="url(#shadow)">
        <text x="1018" y="86">FROSTBOUND RIDGE</text><text x="149" y="299">WILDWOOD</text><text x="550" y="503">HOLLOW GATE PASS</text><text x="1194" y="499">CINDER REACH</text>
      </g>
      <g>
        <path d="M210 222 C260 239 310 252 354 302" fill="none" stroke="#e6f3fc" stroke-opacity=".62" stroke-width="1.5" stroke-dasharray="3 5"/>
        <path d="M744 239 C777 260 804 300 813 354" fill="none" stroke="#e6f3fc" stroke-opacity=".62" stroke-width="1.5" stroke-dasharray="3 5"/>
        <path d="M1196 231 C1176 245 1158 260 1140 278" fill="none" stroke="#e6f3fc" stroke-opacity=".62" stroke-width="1.5" stroke-dasharray="3 5"/>
      </g>
      <g>
        <rect x="87" y="160" width="226" height="61" rx="10" fill="#061426" fill-opacity=".92" stroke="#c6def4" stroke-opacity=".4"/>
        <circle cx="108" cy="181" r="5" fill="#49dfc8"/><text x="123" y="184" fill="#f4f8fc" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="800" letter-spacing=".7">CHICXULUB</text><text x="123" y="204" fill="#b7cadc" font-family="Segoe UI,Arial,sans-serif" font-size="10" letter-spacing="1.3">HOLLOW BEAST</text>
        <rect x="638" y="177" width="231" height="61" rx="10" fill="#061426" fill-opacity=".92" stroke="#c6def4" stroke-opacity=".4"/>
        <circle cx="659" cy="198" r="5" fill="#bd8cff"/><text x="674" y="201" fill="#f4f8fc" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="800" letter-spacing=".7">MUROGANE</text><text x="674" y="221" fill="#b7cadc" font-family="Segoe UI,Arial,sans-serif" font-size="10" letter-spacing="1.3">HOLLOW GATE BULL</text>
        <rect x="1091" y="158" width="266" height="61" rx="10" fill="#061426" fill-opacity=".92" stroke="#c6def4" stroke-opacity=".4"/>
        <circle cx="1112" cy="179" r="5" fill="#fff0e9"/><text x="1127" y="182" fill="#f4f8fc" font-family="Segoe UI,Arial,sans-serif" font-size="14" font-weight="800" letter-spacing=".7">DONKAKU</text><text x="1127" y="202" fill="#b7cadc" font-family="Segoe UI,Arial,sans-serif" font-size="10" letter-spacing="1.3">HOLLOW MAZE MINOTAUR</text>
      </g>
      <g>
        ${bossImage(wolf, 313, 313, 'glowTeal')}
        ${bossImage(bull, 733, 366, 'glowViolet')}
        ${bossImage(minotaur, 1108, 271, 'glowRed')}
      </g>
      <g>
        <circle cx="355" cy="425" r="18" fill="#f5be54" fill-opacity=".15"/><circle cx="355" cy="425" r="11" fill="#f4bd57" stroke="#ffe08a" stroke-width="2"/><circle cx="355" cy="425" r="3" fill="#fff7da"/>
        <circle cx="775" cy="478" r="18" fill="#f5be54" fill-opacity=".15"/><circle cx="775" cy="478" r="11" fill="#f4bd57" stroke="#ffe08a" stroke-width="2"/><circle cx="775" cy="478" r="3" fill="#fff7da"/>
        <circle cx="1150" cy="383" r="18" fill="#f5be54" fill-opacity=".15"/><circle cx="1150" cy="383" r="11" fill="#f4bd57" stroke="#ffe08a" stroke-width="2"/><circle cx="1150" cy="383" r="3" fill="#fff7da"/>
        ${player(254, 429)}${player(456, 455)}${player(671, 470)}${player(842, 492)}${player(1070, 393)}${player(1232, 412)}
      </g>
    </g>
    <rect x="1110" y="711" width="393" height="31" rx="8" fill="#041020" fill-opacity=".84" stroke="#dce9f5" stroke-opacity=".27"/>
    <text x="1306" y="731" fill="#dce9f5" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="700" letter-spacing="1.1">ROSTER PREVIEW · ONE EVENT BOSS ACTIVE AT A TIME</text>
  </g>
  <g font-family="Segoe UI,Arial,sans-serif">
    <g><rect x="60" y="781" width="477" height="71" rx="12" fill="url(#card)" stroke="#294361"/><rect x="75" y="797" width="8" height="39" rx="4" fill="#44d9c2"/><text x="98" y="807" fill="#f2f7fb" font-size="14" font-weight="800" letter-spacing=".8">CHICXULUB</text><text x="98" y="830" fill="#aabdd0" font-size="11">Hollow Beast · turquoise energy</text></g>
    <g><rect x="561" y="781" width="477" height="71" rx="12" fill="url(#card)" stroke="#294361"/><rect x="576" y="797" width="8" height="39" rx="4" fill="#ba89f5"/><text x="599" y="807" fill="#f2f7fb" font-size="14" font-weight="800" letter-spacing=".8">MUROGANE</text><text x="599" y="830" fill="#aabdd0" font-size="11">Hollow Gate bull · violet seal light</text></g>
    <g><rect x="1062" y="781" width="478" height="71" rx="12" fill="url(#card)" stroke="#294361"/><rect x="1077" y="797" width="8" height="39" rx="4" fill="#ff929d"/><text x="1100" y="807" fill="#f2f7fb" font-size="14" font-weight="800" letter-spacing=".8">DONKAKU</text><text x="1100" y="830" fill="#aabdd0" font-size="11">Hollow Maze minotaur · white-red energy</text></g>
  </g>
  <path d="M55 870H1545" stroke="#263e58"/>
  <text x="55" y="887" fill="#91a9c2" font-family="Segoe UI,Arial,sans-serif" font-size="10" letter-spacing="1.5">ROAMING WORLD BOSSES · MAP SPRITE SCALE PREVIEW</text>
  <text x="1545" y="887" fill="#91a9c2" text-anchor="end" font-family="Segoe UI,Arial,sans-serif" font-size="10" letter-spacing="1.5">WORLD BOSS CONCEPT · 01</text>
</svg>`;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  console.log(`Created ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
