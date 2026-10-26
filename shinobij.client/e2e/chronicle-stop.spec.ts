import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';
import { WORLD_DAY_MS, WORLD_HOUR_MS } from '../../shared/world-clock';
import { lifeSceneView, parseLifeState, lifeActorsAt } from '../../shared/sector-life';
import { nextChronicleStop, chronicleStopPlan,chronicleStopActors, type ChronicleStopState } from '../../shared/sector-chronicle-stop';
import { stopChronicleGame } from '../../api/sector/_life-chronicle-game';
import { addChronicleStop } from '../../api/sector/_life-chronicle';
import {isWalkableTile} from '../../shared/sector-walk-mask';

const evidence = process.env.CHRONICLE_STOP_EVIDENCE_DIR??'../output/living-world/chronicle-browser'; mkdirSync(evidence, { recursive: true });
// Fixed, not Date.now(): a roaming Legacy Emissary ignores quietRoadCooldowns, and no sector has one at any hour of 2026-10-10 (01:00 UTC is world noon).
const CHRONICLE_SCENARIO_EPOCH = Date.UTC(2026, 9, 10, 1);
for (const mode of ['complete', 'rain', 'offline', 'visibility resume', 'crowded stop'] as const) test(`travelers play Chronicle at the painted tea table: ${mode}`, async ({ page }, info) => {
    if(mode==='offline')test.setTimeout(600_000);
    let start = Math.floor(CHRONICLE_SCENARIO_EPOCH / WORLD_DAY_MS) * WORLD_DAY_MS + 20 * WORLD_HOUR_MS;
    if (mode === 'crowded stop') for (let day = 0; day < 10; day++) { if (lifeActorsAt(42, start + 60_000, 'clear').some(actor => actor.id === 'gen')) break; start += WORLD_DAY_MS; }
    const window = Math.floor(start / WORLD_HOUR_MS);
    const game = stopChronicleGame(window), plan = chronicleStopPlan({ window }, game);
    // Join the shared visit just before its final arrival. The complete entry
    // and exit paths are checked by the navigator tests; this browser fixture
    // observes the last approach, the match and the departure without replacing
    // thirty seconds of authored walking with an artificial instantaneous jump.
    const bootAt=plan.matchAt-7000;
    await page.clock.install({ time: new Date(bootAt) });await page.clock.setFixedTime(new Date(bootAt));
    const save = uiAuditSave(); save.currentSector = 42; save.currentTile = mode==='crowded stop'?125:65;
    save.character = { ...save.character, starterCardsClaimed: true, wandererCooldowns: quietRoadCooldowns([42], start) };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    let weather = 'clear', state: ChronicleStopState | undefined, offline = false, polls = 0;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/world-state**', route => route.fulfill({ json: { territories: [{ sector: 42, ownerClan: 'ReviewHolding', weather, hp: 100 }], wars: [], standings: [] } }));
    await page.route('**/api/sector/life**', async route => {
        polls++; if (offline) { await route.abort(); return; }
        const now = await page.evaluate(() => Date.now()); state = nextChronicleStop(state, now, weather, game);
        const base = lifeSceneView(42, { ...parseLifeState(null, now), ...(mode === 'crowded stop' ? { step: 3, updatedAt: start - 1000 } : {}) }, now, weather);
        await route.fulfill({ json: { ok: true, serverNow: now, view: state ? addChronicleStop(base, state, game, now) : base } });
    });
    await page.goto('/#/worldMap'); const back = page.getByRole('button', { name: 'Return to Sector 42', exact: false });
    await expect.poll(async () => await back.isVisible() || await page.locator('.continuous-world-map').isVisible(), { timeout: 60_000 }).toBe(true); if (await back.isVisible()) await back.click();
    const map = page.locator('.continuous-world-map'), first = page.locator('[data-life-resident="chronicle:0"]'), second = page.locator('[data-life-resident="chronicle:1"]');
    await expect(map).toHaveAttribute('aria-busy', 'false'); await expect(first).toBeVisible(); await expect(second).toBeVisible();
    await expect.poll(()=>Promise.all([first,second].map(actor=>actor.getAttribute('data-activity')))).toContain('Walking to the tea table');
    await map.screenshot({ path: `${evidence}/${info.project.name}-${mode}-arriving.png` });
    await page.clock.setSystemTime(new Date(bootAt));
    await page.clock.fastForward(plan.matchAt + 1000 - await page.evaluate(() => Date.now())); await page.clock.runFor(4000);
    await expect(first).toHaveAttribute('data-activity', /Chronicle turn/); await expect(second).toHaveAttribute('data-activity', /Chronicle turn/);
    await expect(page.locator('[data-life-resident="resident:42"]')).toBeVisible();
    const pose = (selector: string) => page.locator(selector).evaluate(el => {
        const values = el.style.transform.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)/)!, grid = el.closest('.continuous-world-chunk')!, box = grid.getBoundingClientRect(), css = getComputedStyle(grid);
        const px = parseFloat(css.paddingLeft) || 0, py = parseFloat(css.paddingTop) || 0, gx = parseFloat(css.columnGap) || 0, gy = parseFloat(css.rowGap) || 0, tw = (box.width - 2 * px - 11 * gx) / 12, th = (box.height - 2 * py - 11 * gy) / 12;
        return [(Number(values[1]) - px - tw / 2) / (tw + gx), (Number(values[2]) - py - th / 2) / (th + gy)];
    });
    // A time jump now follows the protected route around the tabletop. Advance
    // the simulated navigator while waiting for arrival; waiting in wall time
    // alone does not advance the fake animation clock after runFor().
    for (const [id, col] of [[0, 2], [1, 4]]) await expect.poll(async () => { await page.clock.runFor(1000); const p = await pose(`[data-life-resident="chronicle:${id}"]`); return Math.hypot(p[0] - col, p[1] - 9); }).toBeLessThan(.2);
    const painting = () => page.evaluate(async () => (await import('/src/lib/sector-life-art.ts')).sectorLifePainting(42));
    await expect.poll(painting).toBe('/sector-life/midlands-herb-chronicle-table-v2.webp');
    if (mode === 'crowded stop') {
        await expect(page.locator('[data-life-resident="gen"]')).toBeVisible();
        await expect(page.locator('[data-life-resident="visitor:42"]')).toBeVisible();
        await expect(page.locator('[data-life-resident]')).toHaveCount(5);
        await expect.poll(async()=>map.locator('.sector-wanderer-label').evaluateAll(labels=>{
            const entries=labels.map(label=>({label:label.getBoundingClientRect(),body:label.parentElement!.querySelector('.sector-avatar-body')!.getBoundingClientRect()}));
            return entries.every((a,i)=>entries.every((b,j)=>i===j||a.label.right+1<=b.label.left||b.label.right+1<=a.label.left||a.label.bottom+1<=b.label.top||b.label.bottom+1<=a.label.top));
        })).toBe(true);
    }
    await page.mouse.move(2, 2); await map.screenshot({ path: `${evidence}/${info.project.name}-${mode}-playing.png` });
    if(mode==='crowded stop')writeFileSync(`${evidence}/${info.project.name}-labels.json`,JSON.stringify(await map.locator('.sector-wanderer-label').evaluateAll(labels=>labels.map(label=>{
        const rect=(element:Element)=>{const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        return {name:label.textContent,rect:rect(label),body:rect(label.parentElement!.querySelector('.sector-avatar-body')!),translate:(label as HTMLElement).style.translate,lane:(label as HTMLElement).style.getPropertyValue('--label-lane')};
    })),null,2));
    const a = (await first.locator('.sector-wanderer-label').boundingBox())!, b = (await second.locator('.sector-wanderer-label').boundingBox())!;
    expect(Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) || Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y)).toBe(true);
    await first.click(); await expect(page.getByRole('dialog')).toContainText('Our life points are');
    await page.getByRole('dialog').screenshot({ path: `${evidence}/${info.project.name}-${mode}-turn-dialogue.png` });
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await second.click();await expect(page.getByRole('dialog')).toContainText('Our life points are');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    expect(await page.locator('.sector-life-point').evaluate(node=>{const r=node.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.sector-life-point')===node;}),'the work button stays independently reachable beside Sada').toBe(true);
    if(mode==='crowded stop'){
        for(const id of ['visitor:42','gen']){
            const watcher=page.locator(`[data-life-resident="${id}"]`);await expect.poll(async()=>{await page.clock.runFor(500);return watcher.getAttribute('data-activity');}).toBe('Watching Chronicle');
            await watcher.click();await expect(page.getByRole('dialog')).toContainText('Their life points are');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
        }
        await map.screenshot({path:`${evidence}/${info.project.name}-actual-spectators.png`});
    }
    if (mode === 'visibility resume') {
        // Controlled visibility events exercise the production pause/resume
        // subscribers while the fake server clock crosses the shift boundary.
        const before = polls;
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.fastForward(start + WORLD_HOUR_MS + 1000 - await page.evaluate(() => Date.now()));
        expect(polls).toBe(before);
        await page.evaluate(() => { delete (document as Document & { hidden?: boolean }).hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.runFor(1000); await expect.poll(() => polls).toBeGreaterThan(before);
        await expect(first).toHaveCount(0); await expect(second).toHaveCount(0);
        await expect.poll(painting).toBe('/sector-life/midlands-herb-tea-stop-v2.webp');
        await map.screenshot({ path: `${evidence}/${info.project.name}-visibility-restored.png` }); expect(errors).toEqual([]); return;
    }
    if (mode === 'rain') {
        weather = 'rain'; const previous = polls; await page.clock.fastForward(21_000); await expect.poll(() => polls).toBeGreaterThan(previous);
        await expect(first).toHaveAttribute('data-activity', 'Putting the Chronicle cards away'); expect(state?.closedAt).toBeDefined();
        await map.screenshot({ path: `${evidence}/${info.project.name}-rain-packing.png` });
        await page.clock.fastForward(7000); await page.clock.runFor(2000); await expect.poll(painting).toBe('/sector-life/midlands-herb-tea-stop-v2.webp');
        const closedAt = state!.closedAt; weather = 'clear'; await page.clock.fastForward(21_000); expect(state!.closedAt).toBe(closedAt);
    } else {
        if (mode === 'offline') offline = true;
        await page.clock.fastForward(plan.packAt + 1000 - await page.evaluate(() => Date.now()));
        await expect(first).toHaveAttribute('data-activity', 'Putting the Chronicle cards away');
        if (mode === 'complete' || mode === 'crowded stop') {
            await first.click(); await expect(page.getByRole('dialog')).toContainText(game.winner ? `${game.winner} won our Chronicle match` : 'ended in a draw');
            await page.getByRole('dialog').screenshot({ path: `${evidence}/${info.project.name}-match-result.png` });
            await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
        }
        await page.clock.fastForward(plan.cardsUntil + 2000 - await page.evaluate(() => Date.now())); await page.clock.runFor(2000);
        await expect.poll(painting).toBe('/sector-life/midlands-herb-tea-stop-v2.webp');
    }
    await map.screenshot({ path: `${evidence}/${info.project.name}-${mode}-leaving.png` });
    const supplier = (await page.locator('[data-life-resident="resident:42"] .sector-wanderer-label').boundingBox())!;
    for (const actor of [first, second]) if (await actor.isVisible()) {
        const label = (await actor.locator('.sector-wanderer-label').boundingBox())!;
        expect(Math.min(supplier.x + supplier.width, label.x + label.width) <= Math.max(supplier.x, label.x) || Math.min(supplier.y + supplier.height, label.y + label.height) <= Math.max(supplier.y, label.y)).toBe(true);
    }
    const departurePoses:{at:number;positions:number[][];visible:boolean[]}[]=[];
    const readDeparture=()=>page.evaluate(async()=>{
        const registry=await import('/src/lib/figure-ground-position.ts');
        const nodes=[0,1].map(id=>document.querySelector<HTMLElement>(`[data-life-resident="chronicle:${id}"]`)!);
        return{at:Date.now(),positions:nodes.map(node=>{const p=registry.figureGroundPosition(node);if(!p)throw Error('Published Chronicle ground position missing');return[p.col,p.row];}),visible:nodes.map(node=>node.style.visibility!=='hidden')};
    });
    if(mode==='offline'){await page.evaluate(async()=>(await import('/src/lib/figure-ground-position.ts')).observeFigureGroundPositions());await page.clock.runFor(50);}
    let prior=mode==='offline'?await readDeparture():undefined;
    await page.clock.fastForward(start + WORLD_HOUR_MS - 1000 - await page.evaluate(() => Date.now()));
    if(mode==='offline'){
        const afterJump=await readDeparture();
        writeFileSync(`${evidence}/${info.project.name}-offline-clock-jump.json`,JSON.stringify({before:prior,after:afterJump},null,2));
        afterJump.positions.forEach((p,id)=>expect(Math.hypot(p[0]-prior!.positions[id][0],p[1]-prior!.positions[id][1])).toBeLessThan(.35));prior=afterJump;
    }
    for(let i=0;i<30;i++){
        await page.clock.runFor(2000);
        const visible=await Promise.all([first,second].map(actor=>actor.isVisible()));
        if(mode==='offline'){
            const sample=await readDeparture(),elapsed=(sample.at-prior!.at)/1000;
            departurePoses.push(sample);writeFileSync(`${evidence}/${info.project.name}-offline-departure-poses.json`,JSON.stringify(departurePoses,null,2));
            for(const [id,p]of sample.positions.entries()){
                expect(Math.hypot(p[0]-prior!.positions[id][0],p[1]-prior!.positions[id][1])).toBeLessThan(.6*elapsed+.15);
                const tile=Math.round(p[1])*12+Math.round(p[0]);expect(isWalkableTile(42,tile)).toBe(true);
                expect([99,111,id===0?112:110]).not.toContain(tile);
            }
            prior=sample;
        }
        if(visible.every(v=>!v))break;
    }
    await expect(first).toBeHidden(); await expect(second).toBeHidden();
    if(mode==='offline')for(const [id,actor]of chronicleStopActors({window},game,start).entries()){const exit=actor.hideTile??actor.restTile;expect(Math.hypot(prior!.positions[id][0]-exit%12,prior!.positions[id][1]-Math.floor(exit/12))).toBeLessThan(.18);}
    await expect.poll(painting).toBe('/sector-life/midlands-herb-tea-stop-v2.webp'); expect(errors).toEqual([]);
});
