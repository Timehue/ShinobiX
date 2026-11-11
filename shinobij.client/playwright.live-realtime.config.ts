import { defineConfig } from '@playwright/test';
import live from './playwright.live.config';

// The live Express suite with the realtime (Socket.IO) layer switched on, for
// the specs where two clients must see each other: connected-sector-presence,
// tavern-chat-push and the socket half of village-outskirts. Run them with
// `npm run test:e2e:live:realtime -- <spec>`; nothing has to be set in the shell.
//
// Those specs read LIVE_E2E_REALTIME. Playwright loads this file in the runner
// and in every worker, so setting it here reaches them. CI still sets the same
// variable on its realtime steps, which ends in the identical server.
process.env.LIVE_E2E_REALTIME = '1';

const { webServer } = live;
if (!webServer || Array.isArray(webServer)) throw new Error('playwright.live.config.ts must define one webServer');

export default defineConfig({
    ...live,
    outputDir: 'test-results/live-express-realtime',
    webServer: { ...webServer, env: { ...webServer.env, DISABLE_REALTIME: '0' } },
});
