import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { artAuditCatalog } from '../features/cinematic-vn/art-audit-catalog';
import { resolveVnPresentation } from './vn-presentation';
import { defaultVnScene } from './vn';

test('the optional classic reader is the only remaining legacy VN renderer', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const legacyRenderers = readdirSync(root, { recursive: true }).filter((file): file is string =>
        typeof file === 'string' && file.endsWith('.tsx'))
        .filter(file => /className=[^\n]*(?:["']vn-stage |["']vn-character )/.test(readFileSync(path.join(root, file), 'utf8')))
        .map(file => file.replaceAll('\\', '/'));
    assert.deepEqual(legacyRenderers, ['components/TriggeredVisualNovel.tsx']);
});

test('every shipped catalog page defaults to the cinematic reader', async () => {
    let pages = 0;
    for (const { key, event } of await artAuditCatalog()) for (const [pageIndex, page] of (event.vnPages ?? []).entries()) {
        const presentation = resolveVnPresentation({ event, page, pageIndex, lineIndex: 0,
            speaker: page.speaker || 'Narrator', speakingSide: null,
            pageImage: page.image || event.image || defaultVnScene(event.id, event.biome) });
        assert.equal(presentation.mode, 'cinematic', `${key} page ${pageIndex} unexpectedly uses the legacy reader`);
        pages++;
    }
    assert.ok(pages >= 1225);
});

test('archive and Echoes entry points forward the live avatar store to the reader', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const source = (file: string) => readFileSync(path.join(root, file), 'utf8');
    for (const component of ['StoryHall', 'EchoesOfWar']) {
        assert.match(source('App.tsx'), new RegExp(`<${component}\\b[\\s\\S]*?sharedImages=\\{sharedImages\\}`));
    }
    assert.match(source('screens/StoryBoss.tsx'), /<StoryJourney\b[^\n]*sharedImages=\{sharedImages\}/);
    for (const file of ['components/StoryJourney.tsx', 'screens/EchoesOfWar.tsx']) {
        assert.match(source(file), /<TriggeredVisualNovel\b[\s\S]*?sharedImages=\{sharedImages\}/, file);
    }
});
