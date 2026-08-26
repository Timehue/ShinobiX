import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const srcDir = join(process.cwd(), 'shinobij.client', 'src');
const stylesDir = join(srcDir, 'styles');
const authority = join(stylesDir, 'layout', 'adaptive-shell.css');
const stageAuthority = join(stylesDir, 'layout', 'adaptive-stages.css');

function cssFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = join(directory, entry.name);
        return entry.isDirectory() ? cssFiles(target) : entry.name.endsWith('.css') ? [target] : [];
    });
}

function ruleBlocks(css: string): Array<{ selector: string; body: string }> {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks: Array<{ selector: string; body: string }> = [];
    const opener = /([^{}]+)\{/g;
    for (let match = opener.exec(withoutComments); match; match = opener.exec(withoutComments)) {
        const selector = match[1].trim();
        if (selector.startsWith('@')) continue;
        let depth = 1;
        let cursor = match.index + match[0].length;
        const start = cursor;
        while (cursor < withoutComments.length && depth > 0) {
            if (withoutComments[cursor] === '{') depth += 1;
            else if (withoutComments[cursor] === '}') depth -= 1;
            cursor += 1;
        }
        if (depth === 0) blocks.push({ selector, body: withoutComments.slice(start, cursor - 1) });
    }
    return blocks;
}

const shellClassNames = [
    'app-shell', 'center-game', 'left-profile-card', 'right-menu-panel',
    'sector-banner-panel', 'mobile-top-hud', 'mobile-bottom-nav',
] as const;

function rightmostCompound(selector: string): string {
    let parentheses = 0;
    let brackets = 0;
    for (let index = selector.length - 1; index >= 0; index -= 1) {
        const char = selector[index];
        if (char === ')') parentheses += 1;
        else if (char === '(') parentheses -= 1;
        else if (char === ']') brackets += 1;
        else if (char === '[') brackets -= 1;
        else if (parentheses === 0 && brackets === 0 && (/\s/.test(char) || char === '>' || char === '+' || char === '~')) {
            return selector.slice(index + 1).trim();
        }
    }
    return selector.trim();
}

function selectorList(selectorListText: string): string[] {
    const selectors: string[] = [];
    let parentheses = 0;
    let brackets = 0;
    let start = 0;
    for (let index = 0; index < selectorListText.length; index += 1) {
        const char = selectorListText[index];
        if (char === '(') parentheses += 1;
        else if (char === ')') parentheses -= 1;
        else if (char === '[') brackets += 1;
        else if (char === ']') brackets -= 1;
        else if (char === ',' && parentheses === 0 && brackets === 0) {
            selectors.push(selectorListText.slice(start, index).trim());
            start = index + 1;
        }
    }
    selectors.push(selectorListText.slice(start).trim());
    return selectors.filter(Boolean);
}

function selectorTargetsShell(selector: string): boolean {
    const subject = rightmostCompound(selector);
    if (subject.includes('::')) return false;
    return shellClassNames.some((className) => new RegExp(`\\.${className}(?![a-zA-Z0-9_-])`).test(subject));
}

function selectorTargetsNormalRoot(selector: string): boolean {
    const subject = rightmostCompound(selector);
    if (subject.includes('::')) return false;
    return /^(?:html|body|#root|\.game)$/.test(subject);
}
const forbiddenGeometry = /(?:^|;)\s*(?:position|inset|top|right|bottom|left|width|inline-size|min-width|min-inline-size|max-width|max-inline-size|height|block-size|min-height|min-block-size|max-height|max-block-size|margin(?:-(?:left|right|inline|inline-start|inline-end))?|padding(?:-(?:top|bottom|left|right|inline|block))?|display|grid-(?:column|row)|overflow(?:-[xy])?|z-index|transform)\s*:/m;

test('normal shell geometry has one stylesheet authority', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(srcDir)) {
        if (file === authority) continue;
        for (const rule of ruleBlocks(readFileSync(file, 'utf8'))) {
            const selectors = selectorList(rule.selector);
            if (!selectors.some(selectorTargetsShell)) continue;
            if (forbiddenGeometry.test(rule.body)) offenders.push(`${relative(srcDir, file)}: ${rule.selector}`);
        }
    }
    assert.deepEqual(offenders, [], `shell geometry escaped adaptive-shell.css:\n${offenders.join('\n')}`);
});

test('viewport-prefixed selectors cannot reclaim normal shell geometry', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(srcDir)) {
        if (file === authority) continue;
        for (const rule of ruleBlocks(readFileSync(file, 'utf8'))) {
            const selectors = selectorList(rule.selector).map((selector) => selector.replace(/\s+/g, ' ').trim());
            const targetsViewportShell = selectors.some((selector) =>
                /^html\[data-vp=[^\]]+\]\s+/.test(selector) && selectorTargetsShell(selector));
            if (targetsViewportShell && forbiddenGeometry.test(rule.body)) {
                offenders.push(`${relative(srcDir, file)}: ${rule.selector}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `viewport CSS reclaimed adaptive shell geometry:\n${offenders.join('\n')}`);
});

test('normal application root geometry has one stylesheet authority', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(srcDir)) {
        if (file === authority) continue;
        for (const rule of ruleBlocks(readFileSync(file, 'utf8'))) {
            const selectors = selectorList(rule.selector);
            if (!selectors.some(selectorTargetsNormalRoot)) continue;
            if (forbiddenGeometry.test(rule.body)) offenders.push(`${relative(srcDir, file)}: ${rule.selector}`);
        }
    }
    assert.deepEqual(offenders, [], `normal root geometry escaped adaptive-shell.css:\n${offenders.join('\n')}`);
});

test('normal application roots cannot be globally scaled', () => {
    const allCss = cssFiles(stylesDir).map((file) => readFileSync(file, 'utf8')).join('\n');
    const rootScale = /(?:html|body|#root|\.app-shell|\.center-game)\s*\{[^}]*?(?:zoom\s*:|transform\s*:\s*[^;}]*scale\s*\()/gis;
    assert.equal(rootScale.test(allCss), false, 'root/application scaling is forbidden');
    assert.doesNotMatch(allCss, /\.center-game\s*\{[^}]*width\s*:\s*100vw/si);
});

test('board scaling keeps one observer authority with explicit cleanup', () => {
    const source = readFileSync(join(srcDir, 'lib', 'use-board-scale.ts'), 'utf8');
    assert.match(source, /new ResizeObserver\(update\)/);
    assert.match(source, /observerCleanupRef\.current\?\.\(\)/);
    assert.match(source, /observer\.disconnect\(\)/);
    assert.doesNotMatch(source, /window\.addEventListener\("resize"/);
});

test('specialized coordinate stages preserve their source geometry', () => {
    const mapHook = readFileSync(join(srcDir, 'lib', 'use-world-map-zoom.ts'), 'utf8');
    const stages = readFileSync(stageAuthority, 'utf8');
    const legacyMobile = readFileSync(join(stylesDir, 'index', '24-combat-mobile-restore.css'), 'utf8');
    assert.match(mapHook, /WORLD_MAP_ASPECT_RATIO = 1672 \/ 941/);
    assert.match(mapHook, /"--wm-map-ar"[^\n]+WORLD_MAP_ASPECT_RATIO/);
    assert.match(stages, /aspect-ratio: var\(--wm-map-ar, 1672 \/ 941\)/);
    assert.match(stages, /grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
    assert.match(stages, /aspect-ratio: 1/);
    assert.doesNotMatch(legacyMobile, /(?:width|min-width):\s*(?:720|1020|1100)px/);
    assert.doesNotMatch(legacyMobile, /(?:height|min-height):\s*(?:640|720|733)px/);
});

test('world-map resize, pointer loss, and observers have bounded cleanup', () => {
    const mapHook = readFileSync(join(srcDir, 'lib', 'use-world-map-zoom.ts'), 'utf8');
    assert.match(mapHook, /logicalX/);
    assert.match(mapHook, /logicalY/);
    assert.match(mapHook, /onLostPointerCapture/);
    assert.match(mapHook, /onPointerCancel: cancelPointer/);
    assert.doesNotMatch(mapHook, /onPointerCancel: endPointer/);
    assert.match(mapHook, /resizeCleanupRef\.current\?\.\(\)/);
    assert.match(mapHook, /ro\?\.disconnect\(\)/);
    assert.match(mapHook, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
    assert.match(mapHook, /removeEventListener\("wheel", onWheel\)/);
    assert.doesNotMatch(mapHook, /window\.addEventListener\("resize"/);
});

test('all full-screen pet modes use the shared takeover contract', () => {
    const petFiles = [
        join(srcDir, 'components', 'PetColiseum.tsx'),
        join(srcDir, 'components', 'PetWarfrontMatch.tsx'),
        join(srcDir, 'components', 'PetBoardArena.tsx'),
    ].map((file) => readFileSync(file, 'utf8')).join('\n');
    const stages = readFileSync(stageAuthority, 'utf8');
    assert.ok((petFiles.match(/pet-combat-takeover/g) ?? []).length >= 5);
    assert.doesNotMatch(petFiles, /zIndex:\s*200/);
    assert.doesNotMatch(petFiles, /height:\s*"100vh"/);
    assert.match(stages, /\.pet-combat-takeover[\s\S]*block-size: 100dvh/);
    assert.match(stages, /z-index: var\(--z-combat\)/);
});

test('pet WebGL stages release pointer and timer resources without extra Warfront scene renders', () => {
    const warfront = readFileSync(join(srcDir, 'components', 'PetWarfrontMatch.tsx'), 'utf8');
    const board = readFileSync(join(srcDir, 'components', 'PetBoardArena.tsx'), 'utf8');
    const stages = readFileSync(stageAuthority, 'utf8');
    assert.match(warfront, /setPointerCapture\(e\.pointerId\)/);
    assert.match(warfront, /lostpointercapture/);
    assert.doesNotMatch(warfront, /<WfMultiCam/);
    assert.doesNotMatch(warfront, /window\.innerWidth/);
    assert.match(board, /useTexture\(gauntletBoard\)/);
    assert.match(board, /useTexture\.preload\(gauntletBoard\)/);
    assert.match(board, /data-arena-map="stone-lava"/);
    assert.match(board, /meshBasicMaterial map=\{floor\} color="#ffffff" toneMapped=\{false\}/);
    assert.match(board, /popTimers\.current\.clear\(\)/);
    assert.match(stages, /\.pet-combat-takeover canvas[\s\S]*touch-action: none/);
});

test('adaptive CSS authorities load after legacy and theme styles', () => {
    const main = readFileSync(join(srcDir, 'main.tsx'), 'utf8');
    const theme = main.indexOf("./styles/veiled-steel.css");
    const shell = main.indexOf("./styles/layout/adaptive-shell.css");
    const stages = main.indexOf("./styles/layout/adaptive-stages.css");
    const tools = main.indexOf("./styles/layout/adaptive-tools.css");
    assert.ok(theme >= 0 && theme < shell && shell < stages && stages < tools);
});
