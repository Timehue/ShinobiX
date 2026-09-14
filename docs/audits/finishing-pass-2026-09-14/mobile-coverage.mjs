import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const core=read('shinobij.client/src/types/core.ts').split('export type Screen =')[1].split(';')[0];
const screens=[...core.matchAll(/\|\s*"([^"]+)"/g)].map(m=>m[1]).filter(s=>!s.startsWith('admin'));
const gauntlet=read('shinobij.client/e2e/non-combat-ui-audit.spec.ts').split('const NON_COMBAT_SCREENS = [')[1].split('] as const')[0];
const inGauntlet=new Set([...gauntlet.matchAll(/"([^"]+)"/g)].map(m=>m[1]));
for(const entry of ['arenaDistrict','weeklyBoss','endlessTower','battleTowers']) inGauntlet.add(entry);
const dedicated={
  professionPicker:'e2e/release-smoke.spec.ts',
  arena:'e2e/arena-authenticated.spec.ts',
  arenaDistrict:'e2e/non-combat-ui-audit.spec.ts',
  battleArena:'e2e/shinobi-combat-mobile.spec.ts',
  pvpBattle:'e2e-live/combat-layout-matrix.spec.ts',
  battleTowers:'e2e-live/combat-layout-matrix.spec.ts',
  worldCrisis:'e2e/world-crisis.spec.ts',
  firstPact:'e2e/first-pact-rpg.spec.ts',
  userHub:'e2e/user-hub-social-lists.spec.ts',
  cardClashFreePlay:'e2e/chronicle-duel-ux.spec.ts',
  clanWar2v2:'e2e-live/combat-layout-matrix.spec.ts',
};
const extra={
  clan:['e2e/clan-mobile-roster.spec.ts','e2e/clan-integrity-ux.spec.ts','e2e/clan-exchange-recovery.spec.ts'],
  worldMap:['e2e/world-map-mobile.spec.ts','e2e/adaptive-shell.spec.ts'],
  home:['e2e/pet-home-visual.spec.ts'],
  echoesOfWar:['e2e/echoes-witness.spec.ts'],
  centralHub:['e2e/central-hub-authenticated.spec.ts'],
};
const rows=screens.map(screen=>{
 const primary=inGauntlet.has(screen)?'A':dedicated[screen]?'B':screen==='start'?'C':'E';
 const evidence=inGauntlet.has(screen)?['e2e/non-combat-ui-audit.spec.ts'] : dedicated[screen]?[dedicated[screen]]:screen==='start'?['e2e-visual/release-surfaces.visual.spec.ts']:[];
 return {screen,classification:primary,evidence:[...evidence,...extra[screen]??[]].map(p=>`shinobij.client/${p}`),scope:primary==='A'?'Representative populated route at the five gauntlet viewports; nested dialogs and all possible server states are not implied.':primary==='B'?'Dedicated interaction/layout evidence. Shared combat shell coverage does not certify every parent orchestration or lobby.':primary==='C'?'Existing pixel baselines, full-motion presentation with animation freezing/canvas masking; not device performance.':'No specific strong mobile test established in this audit; shared shell coverage is not credited as this screen coverage.',productionChange:'NONE',manualAndroidRequired:true};
});
const clanRow=rows.find(row=>row.screen==='clan');
if(clanRow)clanRow.productionChange='Exchange only: quietly resume a retained, already-debited purchase on entry/reconnect. No markup or layout change.';
for(const [screen,classification,evidence,scope] of [
 ['character-creation','B',['e2e/release-smoke.spec.ts','e2e/player-journey-ux.spec.ts'],'Creator journey at supported viewport projects; visual creator baseline is desktop.'],
 ['clan-boss-operation','B',['e2e-live/combat-layout-matrix.spec.ts'],'Tower party shell geometry; dedicated boss staging lifecycle still required.'],
 ['pet-warfront-and-gauntlet','E',[],'Separate rendering engines: shinobi/Showdown layout success does not certify these.'],
 ['central-celestial-entry','A',['e2e/non-combat-ui-audit.spec.ts'],'Central modal entry is covered; Endless Tower, Battle Towers, Echoes and First Pact each retain separate destination coverage.'],
 ['android-system-behavior','D',[],'Actual build/device: back, keyboard, system bars, touch hover, rotation, update/install, background/resume, network transitions and performance.'],
 ])rows.push({screen,classification,evidence:evidence.map(p=>`shinobij.client/${p}`),scope,productionChange:'NONE',manualAndroidRequired:true});
fs.writeFileSync('docs/audits/finishing-pass-2026-09-14/mobile-coverage.json',JSON.stringify({auditedCommit:'ecd8d6ccaba017a6791ec0ec94f822c10658984d',legend:{A:'mobile-gauntlet covered',B:'dedicated layout/interaction test covered',C:'visual-regression covered',D:'manual/device-only concern',E:'currently uncovered'},viewports:[[360,800],[390,844],[430,932],[844,390],[1440,900]],limitation:'Coverage means an existing test, not a pass in this run; execution outcomes are in the consolidated report. Screen union includes compatibility routes, not proof every surface is launch-enabled. No new CSS/layout rules or baselines introduced.',rows},null,2)+'\n');
console.log(`${rows.length} player-facing surfaces/system concerns inventoried; ${screens.length} screen-union entries`);
