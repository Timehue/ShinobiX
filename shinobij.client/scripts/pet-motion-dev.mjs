import { createServer } from 'vite';
const server = await createServer({ configFile: 'scripts/vite.pet-colosseum-qa.config.mjs', cacheDir: '.tmp/vite-pet-motion', server: { host: '127.0.0.1', port: 5199, strictPort: true, watch: { ignored: ['**/.tmp/**','**/.playwright-dist-*/**','**/test-results/**'] } } });
await server.listen();
server.printUrls();
