// Loaded into every test child by run-tests.mjs (`--import`).
//
// Client modules import artwork the Vite way — `import art from "./x.webp"` —
// and Vite turns that into a URL string. Plain Node has no idea what a .webp
// module is and throws ERR_UNKNOWN_FILE_EXTENSION, which kills the whole test
// file before a single subtest runs (it reports as a red file with no failing
// test). This hook gives image imports the same shape Vite does: a default
// export holding a URL. Tests that care about a specific asset read the source,
// so the exact string only has to be stable and recognisable.
//
// CSS is deliberately NOT stubbed: the convention is that node-tested modules
// do not import stylesheets, and a stub would hide a violation of it.
import { registerHooks } from 'node:module';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMAGE_ASSET = /\.(?:webp|png|jpe?g|gif|avif|svg)$/i;

registerHooks({
    load(url, context, nextLoad) {
        if (url.startsWith('file:')) {
            const path = fileURLToPath(url);
            if (IMAGE_ASSET.test(path)) {
                return {
                    format: 'module',
                    source: `export default ${JSON.stringify(`/assets/${basename(path)}`)};`,
                    shortCircuit: true,
                };
            }
        }
        return nextLoad(url, context);
    },
});
