import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./e2e',testMatch:'ground-wildlife.spec.ts',timeout:120_000,expect:{timeout:20_000},workers:1,reporter:'line',
 outputDir:'test-results/ground-wildlife',use:{baseURL:'http://127.0.0.1:5198',serviceWorkers:'block',screenshot:'only-on-failure'},
 webServer:{command:'node node_modules/vite/bin/vite.js --config scripts/vite.world-map-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5198 --strictPort',url:'http://127.0.0.1:5198',reuseExistingServer:false,timeout:120_000},
 projects:[{name:'desktop',use:{browserName:'chromium',viewport:{width:1366,height:900}}},{name:'phone',use:{browserName:'chromium',viewport:{width:390,height:844},isMobile:true,hasTouch:true}}],
});
