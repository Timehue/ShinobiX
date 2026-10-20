import { defineConfig } from '@playwright/test';
const port=process.env.SECTOR_LIFE_E2E_PORT??'5198';
if(!/^\d{4,5}$/.test(port))throw new Error('SECTOR_LIFE_E2E_PORT must be a numeric port.');
export default defineConfig({
    testDir:'./e2e',testMatch:['sector-life.spec.ts','local-fauna.spec.ts','regional-training.spec.ts','regional-winter.spec.ts','shrine-work.spec.ts','shrine-traffic.spec.ts','midlands-field.spec.ts','festival-work.spec.ts','road-visits.spec.ts','frontier-work.spec.ts'],timeout:120_000,expect:{timeout:20_000},workers:1,reporter:'line',
    outputDir:'test-results/sector-life',use:{baseURL:`http://127.0.0.1:${port}`,serviceWorkers:'block',screenshot:'only-on-failure'},
    webServer:{command:`node node_modules/vite/bin/vite.js --config scripts/vite.world-map-qa.config.mjs --configLoader runner --host 127.0.0.1 --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false,timeout:120_000},
    projects:[{name:'desktop',use:{browserName:'chromium',viewport:{width:1366,height:900}}},{name:'phone',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
});
