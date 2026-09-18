import test from 'node:test';
import assert from 'node:assert/strict';
import { artAuditCatalog } from '../features/cinematic-vn/art-audit-catalog';
import { overlayVnImages } from './vn-shared-artwork';
import { RETIRED_VN_ART, omitRetiredVnArt, retiredVnArtSources } from './vn-retired-artwork';
import { resolveVnPresentation } from './vn-presentation';
import { defaultVnScene, splitDialogueLine } from './vn';
import type { CreatorEvent } from '../types/vn';

test('removing every reviewed export restores the original background on every catalog line and replay branch', async () => {
    const images = Object.fromEntries(Object.keys(RETIRED_VN_ART).map(id => [id, `/api/img?id=${encodeURIComponent(id)}`]));
    const mismatches: string[] = [];
    let lines = 0;
    for (const { event, key } of await artAuditCatalog()) {
        const hydrated = overlayVnImages(event, event.id, images);
        const sources = retiredVnArtSources(hydrated);
        if (!sources.length) continue;
        const retired = omitRetiredVnArt(hydrated, new Set(sources));
        for (const [pageIndex, page] of event.vnPages!.entries()) for (let lineIndex = 0; lineIndex < page.dialogue.length; lineIndex++) {
            const resolve = (current: CreatorEvent) => {
                const p = current.vnPages![pageIndex];
                const speaker = p.lines?.[lineIndex]?.speaker ?? splitDialogueLine(p.dialogue[lineIndex], p.speaker || current.vnSpeaker || 'Narrator').speaker;
                return resolveVnPresentation({ event: current, page: p, pageIndex, lineIndex, speaker, speakingSide: null,
                    pageImage: p.image || current.image || defaultVnScene(current.id, current.biome) }).backgroundImage;
            };
            const expected = resolve(event), actual = resolve(retired);
            if (expected !== actual) mismatches.push(`${key} p${pageIndex} l${lineIndex}: ${actual} != ${expected}`);
            lines++;
        }
    }
    assert.ok(lines > 500, `checked ${lines} affected lines`);
    assert.deepEqual(mismatches, []);
});
