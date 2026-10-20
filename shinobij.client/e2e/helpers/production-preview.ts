import { readFileSync } from 'node:fs';
import { previewRootFor, smokeE2ePort } from '../../e2e-ports';

/** Call from a test/hook, after webServer has sealed the preview. Chunk
 * interception must inspect the same artifact the browser is actually using,
 * even when another build replaces dist during a long smoke run. */
export function readProductionPreview(relative: string): string {
    return readFileSync(new URL(`../../${previewRootFor(smokeE2ePort())}/${relative}`, import.meta.url), 'utf8');
}
export function productionManifest(): Record<string, { file: string; css?: string[] }> {
    return JSON.parse(readProductionPreview('.vite/manifest.json'));
}
