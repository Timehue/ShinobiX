import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const registry = 'virtual:jutsu-fx-frames';

/** Resolve ordered sprite URLs at build time so clients only receive playable sequences. */
export function jutsuFxFrames(client: string): Plugin {
    const directory = join(client, 'src/assets/fx');
    return {
        name: 'jutsu-fx-frames',
        resolveId(id) { if (id === registry) return '\0' + id; },
        load(id) {
            if (id !== '\0' + registry) return;
            // No addWatchFile on the folders: the dev server records a watched file as
            // an import of this module and then fails to resolve a directory (Pet Gauntlet
            // e2e, 2026-11-12). Every frame below is imported, so each stays tracked.
            const imports: string[] = [];
            const groups: string[] = [];
            for (const folder of readdirSync(directory, { withFileTypes: true })) {
                if (!folder.isDirectory() || folder.name.startsWith('.')) continue;
                const group = join(directory, folder.name);
                const files = readdirSync(group, { withFileTypes: true })
                    .filter(file => file.isFile() && !file.name.startsWith('.') && file.name.endsWith('.png'))
                    .map(file => file.name).sort((a, b) => a.localeCompare(b));
                if (!files.length) continue;
                const frames = files.map(file => {
                    const ref = 'frame' + imports.length;
                    imports.push('import ' + ref + ' from ' + JSON.stringify('/src/assets/fx/' + folder.name + '/' + file + '?url') + ';');
                    return ref;
                });
                groups.push(JSON.stringify(folder.name) + ':[' + frames.join(',') + ']');
            }
            return [...imports, 'export default {' + groups.join(',') + '};'].join('\n');
        },
    };
}
