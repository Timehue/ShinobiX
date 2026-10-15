import { existsSync,readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHRONICLE_PAINTED_ART,CHRONICLE_PAINTED_FIGURES } from '../shared/chronicle-painted-art.js';

// Runs against the actual deployment artifact, without authoring masters or QA
// manifests (those are deliberately excluded from the Docker build context).
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'shinobij.client/dist');
const expected=new Set([
    ...Object.values(CHRONICLE_PAINTED_ART).flatMap(url=>[url,url.replace(/\.webp$/,'-512.webp')]),
    ...Object.values(CHRONICLE_PAINTED_FIGURES).flatMap(pair=>[pair.front,pair.back]),
]);
if(!expected.size)throw Error('Missing Chronicle artwork registry');
for(const url of expected){
    if(!url.startsWith('/chronicle/')||!existsSync(path.join(dist,url)))throw Error('Missing built Chronicle asset: '+url);
}
for(const folder of ['cards','figures']){
    for(const file of readdirSync(path.join(dist,'chronicle',folder))){
        if(!expected.has(`/chronicle/${folder}/${file}`))throw Error('Obsolete or unregistered Chronicle asset in deployment: '+folder+'/'+file);
    }
}
console.log(`chronicle-runtime: ${expected.size} current assets present; no obsolete card or figure files shipped.`);
