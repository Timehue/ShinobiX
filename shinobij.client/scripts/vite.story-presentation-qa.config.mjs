import { mergeConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import base from './vite.world-map-qa.config.mjs';

// Optional read-only source overlay for reproducible before captures. Originals
// were copied before this pass; the working tree is never reverted for a test.
const root = resolve(import.meta.dirname, '../..');
export default mergeConfig(base, { plugins: [{
    name: 'story-presentation-baseline', enforce: 'pre',
    load(id) {
        if (process.env.STORY_PRESENTATION_PHASE !== 'before') return;
        const file = resolve(root, '.tmp/story-presentation-baseline', relative(root, id).replaceAll('\\', '/').replaceAll('/', '__'));
        if (existsSync(file)) return readFileSync(file, 'utf8');
    },
}] });
