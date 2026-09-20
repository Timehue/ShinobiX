// Component comparison, not a game FPS benchmark. Reconstruct the pre-change
// command panel in a temporary source fixture; never edit the working game.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const client = resolve(fileURLToPath(new URL('..', import.meta.url)));
const revision = process.argv[2];
if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Pass the exact baseline commit SHA.');
const scratch = mkdtempSync(resolve(client, '.sector-hud-bench-'));
let browser;
let server;
try {
    let legacy = execFileSync('git', ['show', `${revision}:shinobij.client/src/components/WorldSectorCommandPanel.tsx`], {cwd:client,encoding:'utf8',windowsHide:true});
    legacy = legacy.replaceAll('"../', '"../src/').replaceAll('"../../../shared/', '"../../shared/').replaceAll('"./', '"../src/components/');
    // The generic ../ rewrite also touched the shared path; resolve it exactly.
    legacy = legacy.replaceAll('../src/../../shared/', '../../shared/');
    writeFileSync(resolve(scratch,'legacy.tsx'),legacy);
    writeFileSync(resolve(scratch,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="bench"></div><script type="module" src="./bench.tsx"></script></body></html>');
    writeFileSync(resolve(scratch,'bench.tsx'),`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {WorldSectorCommandPanel as Legacy} from './legacy';
import {SectorHud} from '../src/components/SectorHud';
import '../src/index.css';
import '../src/styles/layout/adaptive-stages.css';
let root;
const noop=()=>{};
const frame=()=>new Promise(requestAnimationFrame);
window.benchmark=async(count,version)=>{
    root?.unmount();
    root=createRoot(document.getElementById('bench'));
    const players=Array.from({length:count},(_,i)=>({target:{name:'Shinobi'+i},name:'Shinobi'+i,level:40,avatarSrc:'',status:'Ready',sleeping:false,actionDisabled:false,attackLabel:{kind:'combat'}}));
    const props={sector:22,present:true,biome:'shadow',weather:'clear',territory:null,gathering:null,contract:null,contractBusy:false,villageWarAdmissionOpen:true,traces:null,hasLivePlayers:true,sectorContest:null,sectorGarrisonReady:false,players,hunt:null,
        onRaidEnemyVillage:noop,onRaidControlledSector:noop,onOpenSigns:noop,onOpenShrine:noop,onStrikeSleeper:noop,onAttackPlayer:noop,onOpenSectorContest:noop,onFightSectorGarrison:noop,onClaimContract:noop,onExplore:noop,onFindRicherGround:noop,onHunt:noop,onRecover:noop,onLeave:noop};
    const start=performance.now();
    flushSync(()=>root.render(<div className="map-instance"><div className="instance-frame sector-instance-frame"><main className="tile-scene sector-stage-panel">{version==='baseline'?<Legacy {...props}/>:<SectorHud {...props} rosterState="current" playerAction={{pending:null,error:null}} onPlayerAction={noop}/>}</main></div></div>));
    const commitMs=performance.now()-start;
    await frame(); await frame();
    const nodesInitial=document.querySelectorAll('#bench *').length;
    // The complete nearby roster appends in frame-sized batches after first paint.
    while(document.querySelector('.sector-roster-list[aria-busy="true"]')) await frame();
    return {commitMs,nodesInitial,nodesComplete:document.querySelectorAll('#bench *').length,completeMs:performance.now()-start};
};
`);
    server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','scripts/vite.world-map-qa.config.mjs','--configLoader','runner','--host','127.0.0.1','--port','5188','--strictPort'],{cwd:client,windowsHide:true,stdio:'ignore',env:{...process.env,VITE_SKIP_HTTPS:'1'}});
    const url=`http://127.0.0.1:5188/${basename(scratch)}/index.html`;
    let ready=false;
    for(let i=0;i<60;i++) {try{ready=(await fetch(url)).ok;}catch{} if(ready)break; await new Promise(resolve=>setTimeout(resolve,250));}
    if(!ready)throw new Error('Local benchmark server did not become ready.');
    browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:1366,height:768},reducedMotion:'reduce'});
    await page.goto(url);
    await page.waitForFunction(()=>typeof window.benchmark==='function');
    await page.evaluate(()=>window.benchmark(8,'baseline'));
    await page.evaluate(()=>window.benchmark(8,'current'));
    const results=[];
    for(const count of [0,1,8,25,100]) for(const version of ['baseline','current']) {
        const samples=[];
        for(let i=0;i<7;i++)samples.push(await page.evaluate(([n,v])=>window.benchmark(n,v),[count,version]));
        results.push({count,version,samples});
    }
    writeFileSync(resolve(client,'../docs/sector-hud-2026-09-19/component-benchmark.json'),JSON.stringify({baseline:revision,viewport:'1366x768',scope:'React component mount/paint only; scene rendering and networking excluded',results},null,2));
    console.log('Saved component benchmark: 5 roster sizes × 2 versions × 7 samples.');
} finally {
    await browser?.close();
    server?.kill();
    // Only the new, task-owned temporary directory may be removed recursively.
    const target=resolve(scratch);
    if(!target.startsWith(client+sep+'.sector-hud-bench-'))throw new Error('Unexpected cleanup target');
    rmSync(target,{recursive:true,force:true});
}
