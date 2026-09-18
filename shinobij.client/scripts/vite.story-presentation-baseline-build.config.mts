import { mergeConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import base from '../vite.config';

const root = resolve(import.meta.dirname, '../..');
export default mergeConfig(base, {
    build: { outDir: '../.tmp/story-presentation-baseline/dist' },
    plugins: [{
        name: 'saved-story-presentation-baseline', enforce: 'pre',
        load(id: string) {
            const file = resolve(root, '.tmp/story-presentation-baseline', relative(root, id).replaceAll('\\', '/').replaceAll('/', '__'));
            if (existsSync(file)) return readFileSync(file, 'utf8');
        },
    }],
});
