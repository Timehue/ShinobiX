import { readFileSync } from 'node:fs';

// These markers belong only to the retired continuous-duel interface.
// Check the emitted artifact too: production builds must fail independently
// of the source-graph CI tests if that interface is ever bundled again.
const retiredMarkers = ['Choose the Fight Plan', 'pet-duel-live-sides'];

export function assertNoRetiredPetUi(files) {
    for (const file of files) {
        if (!file.endsWith('.js') && !file.endsWith('.mjs')) continue;
        const source = readFileSync(file, 'utf8');
        const marker = retiredMarkers.find(value => source.includes(value));
        if (marker) throw new Error(`Retired pet battle UI marker ${JSON.stringify(marker)} in ${file}`);
    }
}
