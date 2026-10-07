import { expect } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { writeFile } from 'node:fs/promises';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { uniquePlayerName } from './helpers/player-names';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { sectorExits, type SectorExit } from '../../shared/sector-links';
import { sectorName, sectorBiomeOf } from '../../shared/sector-geo';
import { quietRoadCooldowns } from './helpers/quiet-road';
// Actual built game, account/save handlers and movement transport; no mocked routes.
type FrameState={running:boolean;previous:number;gaps:number[]};

test.use({contextOptions:{reducedMotion:'no-preference'},video:'on'});
test('quiet village to lavafront journey',async({page,request,context},info)=>{
 test.setTimeout(600_000);
 const name=uniquePlayerName(stamp=>`journey${stamp}`);
 const registered=await request.post('/api/player-auth',{data:{action:'register',name,password:'ConnectedJourney!1234'}});
 expect(registered.status(),await registered.text()).toBe(200);
 const token=String((await registered.json()).token),headers={'x-player-name':name,'x-player-token':token};
 const save=uiAuditSave();save.currentSector=9;save.currentTile=102;
 save.worldGeoV=2;save.currentBiome='forest';
 save.character={...save.character,name,village:'Ashen Leaf Village',storyVillage:'Ashen Leaf Village',equippedJutsuIds:[],jutsuMastery:[],wandererCooldowns:quietRoadCooldowns(Array.from({length:65},(_,i)=>i+1))};
 save.triggeredEvents=(save.triggeredEvents as string[]).map(event=>event.replace('stormveil-village','ashen-leaf-village'));
 const seeded=await request.post(`/api/save/${name}?signal=1`,{headers:{'x-admin-password':'live-express-e2e-admin'},data:save});
 expect(seeded.status(),await seeded.text()).toBe(200);
 expect((await request.post(`/api/save/${name}?ack=1`,{headers})).status()).toBe(200);
 const canonicalResponse=await request.get(`/api/save/${name}`,{headers});expect(canonicalResponse.status()).toBe(200);
 const canonical=await canonicalResponse.json();expect(canonical.currentSector).toBe(9);
 await context.addInitScript(({name,token,canonical,patch})=>{
  localStorage.setItem('ninjav-admin-build-v1',JSON.stringify({currentAccountName:name}));
  localStorage.setItem('ninjav-player-accounts-v1',JSON.stringify({[name]:{token}}));
  localStorage.setItem('shinobix:activePlayerPersist',name);localStorage.setItem('shinobix:activeTokenPersist',token);
  localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`,JSON.stringify(canonical));
  localStorage.setItem('shinobix:storage-notice-ack','1');localStorage.setItem('patchNotes.lastSeenVersion.v1',patch);
  localStorage.setItem('dailyBriefing.seen.v1',new Date().toISOString().slice(0,10));
  localStorage.setItem('legacyRumors.seen.v1:'+name,JSON.stringify([10,20,30,40,45]));
  localStorage.setItem('liteFx.v1','0');
 },{name,token,canonical,patch:LATEST_PATCH_NOTE.version});
 const queue:Array<{sector:number;roads:SectorExit[]}>= [{sector:9,roads:[]}], seen=new Set([9]);
 let roads:SectorExit[]=[];
 for(let index=0;index<queue.length;index++){
  const state=queue[index]!;if(state.sector===58){roads=state.roads;break;}
  for(const exit of sectorExits(state.sector))if(!seen.has(exit.destinationSector)){
   seen.add(exit.destinationSector);queue.push({sector:exit.destinationSector,roads:[...state.roads,exit]});
  }
 }
 expect(roads.length).toBeGreaterThan(0);
 const positionEvents:unknown[]=[];
 page.on('websocket',socket=>{
  socket.on('framesent',({payload})=>{
   const text=String(payload);if(!text.startsWith('42'))return;
   try{const [event,body]=JSON.parse(text.slice(2));if(event==='presence'||event==='presence:move')positionEvents.push({at:Date.now(),transport:'socket-send',event,sector:body.sector,tile:body.tile});}catch{/* Socket.IO control packets carry no tile. */}
  });
 });
 page.on('response',async response=>{
  if(!response.url().includes('/api/player/heartbeat'))return;
  try{const sent=response.request().postDataJSON(),received=await response.json();positionEvents.push({at:Date.now(),transport:'heartbeat',sent:{sector:sent.sector,tile:sent.tile},received:{sector:received.sector,tile:received.tile}});}catch{/* Ignore a heartbeat retired with its page. */}
 });
 await page.goto('/#/worldMap',{waitUntil:'domcontentloaded'});
 const shell=page.locator('.app-shell[data-screen="worldMap"]'),enter=page.getByRole('button',{name:'Enter World Map',exact:true});
 await expect(shell.or(enter)).toBeVisible({timeout:60_000});if(await enter.isVisible())await enter.click();
 await expect(shell).toBeVisible();
 const returnButton=page.getByRole('button',{name:/Return to Sector 9\b/});
 await expect.poll(async()=>await returnButton.isVisible()||await page.locator('.sector-image-map').isVisible()).toBe(true);
 if(await returnButton.isVisible())await returnButton.click();
 const board=page.locator('.pixel-map[data-ground-floor="true"]');await expect(board).toBeVisible();
 await expect(board).toHaveAttribute('aria-busy','false');
 await expect(page.locator('html')).not.toHaveClass(/lite-fx/);
 await expect(page.getByRole('button',{name:'Enter Ashen Leaf Village',exact:true})).toBeEnabled();
 await page.screenshot({path:info.outputPath('journey-village.png'),fullPage:true});
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.evaluate(()=>{
  const state={running:true,previous:0,gaps:[] as number[]};(window as unknown as {quietFrames:FrameState}).quietFrames=state;
  const tick=(now:number)=>{if(state.previous)state.gaps.push(now-state.previous);state.previous=now;if(state.running)requestAnimationFrame(tick);};
  requestAnimationFrame(tick);
 });
 const crossings=[];
 for(const exit of roads){
  const started=Date.now();
  const road=page.getByRole('button',{name:`Cross to ${sectorName(exit.destinationSector)}`,exact:true});
  await road.focus();await road.press('Enter');
  const canvas=board.locator(':scope > canvas');
  await expect(canvas).toHaveAttribute('data-world-sector',String(exit.destinationSector),{timeout:90_000});
  await canvas.focus();await page.keyboard.press('Escape');
  await expect(board.locator('[data-world-self]')).toHaveCount(1);
  expect(Number(await canvas.getAttribute('data-decoded-maps'))).toBeLessThanOrEqual(4);
  const accepted=await(await request.get('/api/player/world-move',{headers})).json();expect(accepted.sector).toBe(exit.destinationSector);
  crossings.push({from:exit.sector,to:exit.destinationSector,direction:exit.direction,milliseconds:Date.now()-started,biome:sectorBiomeOf(exit.destinationSector),worldPosition:accepted.worldPosition});
 }
 await expect(board.locator('.region-splash')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('journey-lavafront.png'),fullPage:true});
 const frames=await page.evaluate(()=>{
  const state=(window as unknown as {quietFrames:FrameState}).quietFrames;state.running=false;const gaps=state.gaps.toSorted((a,b)=>a-b);
  return{samples:gaps.length,medianMs:gaps[Math.floor(gaps.length*.5)],p95Ms:gaps[Math.floor(gaps.length*.95)],over50Ms:gaps.filter(gap=>gap>50).length,liteFx:document.documentElement.classList.contains('lite-fx')};
 });
 expect(errors).toEqual([]);
 const underLoad=process.env.WORLD_JOURNEY_UNDER_LOAD==='1';
 await writeFile(info.outputPath('quiet-journey.json'),JSON.stringify({project:info.project.name,crossings,frames,errors,realExpress:true,mockedRoutes:0,measurementMode:underLoad?'functional-preflight-under-concurrent-suite-load':process.env.WORLD_JOURNEY_QUIET==='1'?'quiet-after-heavy-suites':'local-real-server-journey',scope:'Full-motion actual built game, local Express with isolated in-memory QA storage and authoritative travel API; emulated viewport, not a physical phone or internet benchmark.'},null,2));
});
