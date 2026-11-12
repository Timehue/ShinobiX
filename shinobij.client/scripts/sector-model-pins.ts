import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const registry = 'virtual:sector-model-pins';

export function sectorModelPins(client: string): Plugin {
    const directory = path.join(client, 'src/data/sector-models');
    const portraitFiles = new Set<string>();
    let serving = false;
    return {
        name: 'sector-model-pins',
        configureServer(server) {
            serving = true;
            // Dev import analysis treats addWatchFile entries as module imports.
            // Directories and public portraits are filesystem inputs to the pins.
            server.watcher.on('all', (event, file) => {
                if (!['add', 'unlink', 'change'].includes(event)) return;
                const resource = path.resolve(file);
                if (!(path.dirname(resource) === directory && resource.endsWith('.json')) && !portraitFiles.has(resource)) return;
                const mod = server.moduleGraph.getModuleById('\0' + registry);
                if (mod) {
                    server.moduleGraph.invalidateModule(mod);
                    server.ws.send({ type: 'full-reload' });
                }
            });
        },
        resolveId(id) {
            if (id === registry) return '\0' + registry;
        },
        load(id) {
            if (id !== '\0' + registry) return;
            const imports: string[] = [];
            const models: [string,string][] = [];
            const portraits: string[] = [];
            const seen = new Set<string>();
            if (!serving) this.addWatchFile(directory);
            portraitFiles.clear();
            for (const file of readdirSync(directory).filter(name => name.endsWith('.json')).sort()) {
                const slug = file.slice(0,-5);
                const filename = path.join(directory,file);
                if (!serving) this.addWatchFile(filename);
                const pin = JSON.parse(readFileSync(filename,'utf8'));
                if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^[a-f0-9]{64}$/.test(pin.manifestSha256) ||
                    !/^(src\/assets|public)\/[\w./-]+\.webp$/.test(pin.portrait) || pin.portrait.split('/').includes('..'))
                    throw new Error('Invalid sector model pin in '+file);
                const source = path.join(client,pin.portrait);
                portraitFiles.add(source);
                if (!serving) this.addWatchFile(source);
                if (createHash('sha256').update(readFileSync(source)).digest('hex') !== pin.portraitSha256)
                    throw new Error('Sector model needs a new fit for '+pin.portrait);
                models.push([slug,pin.manifestSha256]);
                if (slug === 'starter-one' || slug === 'starter-two') {
                    portraits.push('null');
                    continue;
                }
                if (seen.has(pin.portrait)) throw new Error('Duplicate sector model for '+pin.portrait);
                seen.add(pin.portrait);
                let url: string;
                if (pin.portrait.startsWith('public/')) {
                    url = JSON.stringify('/'+pin.portrait.slice('public/'.length));
                } else {
                    url = 'portrait'+imports.length;
                    imports.push('import '+url+' from '+JSON.stringify('/'+pin.portrait+'?url')+';');
                }
                portraits.push(url);
            }
            const store = fileURLToPath(new URL('../src/lib/sector-model-pin-store.ts', import.meta.url)).replaceAll('\\','/');
            const reader = serving ? 'Promise.resolve('+JSON.stringify(models)+')' : (() => {
                const reference = this.emitFile({type:'asset', name:'sector-model-pins.json', source:JSON.stringify(models)});
                return 'fetch(import.meta.ROLLUP_FILE_URL_'+reference+').then(r=>{if(!r.ok)throw Error("Model registry unavailable");return r.json()})';
            })();
            return [...imports,'import {createSectorModelPinStore} from '+JSON.stringify(store)+';',
                'export const {revisions,portraitModels,loadPins,subscribe,snapshot}=createSectorModelPinStore(['+portraits.join(',')+'],()=>'+reader+');'].join('\n');
        },
    };
}
