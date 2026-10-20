import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';
import { advanceLifeEvent, lifeSceneView, parseLifeState, LIFE_WINDOW_MS, LIFE_ACTIVE_MS } from '../../shared/sector-life';
import { dockShipmentPlan, DOCK_SHIPMENT_LINES as L, DOCK_SHIPMENT_PAINTINGS as P, DOCK_SHIPMENT_SCENARIO, DOCK_SHIPMENT_DELIVERY_MS } from '../../shared/sector-dock-shipment';

const evidence = '../output/living-world/shipment/browser/complete-v2';
mkdirSync(evidence, { recursive: true });
for (const mode of ['aided', 'cached outage', 'unattended'] as const) test(`dock shipment: ${mode}`, async ({ page }, info) => {
    const start = 300 * LIFE_WINDOW_MS;
    const bootAt = start + (mode === 'unattended' ? LIFE_ACTIVE_MS - 2000 : 60_000);
    await page.clock.install({ time: new Date(bootAt) });
    await page.clock.setFixedTime(new Date(bootAt));
    const save = uiAuditSave(); save.currentSector = 2; save.currentTile = mode === 'unattended' ? 101 : 68;
    save.character = { ...save.character, village: 'Ashen Leaf Village', starterCardsClaimed: true, wandererCooldowns: quietRoadCooldowns([2], bootAt) };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10,20,30,40,45])));
    let state = parseLifeState(null, bootAt), offline = false, polls = 0, posts = 0;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/world-state**', route => route.fulfill({ json: { territories: [{ sector: 2, ownerClan: 'ReviewHolding', weather: 'clear', hp: 100 }], wars: [], standings: [] } }));
    await page.route('**/api/sector/life**', async route => {
        polls++; if (offline) { await route.abort(); return; }
        const now = await page.evaluate(() => Date.now());
        if (route.request().method() === 'POST') {
            posts++; const body = route.request().postDataJSON();
            state = advanceLifeEvent(2, state, body.window, body.step, 'auditninja', now).state;
        }
        await route.fulfill({ json: { ok: true, serverNow: now, view: lifeSceneView(2, parseLifeState(state, now), now, 'clear', 'Ashen Leaf Village', undefined, undefined, undefined, 'auditninja') } });
    });
    await page.goto('/#/worldMap'); const back = page.getByRole('button', { name: 'Return to Sector 2', exact: false });
    const map = page.locator('.continuous-world-map');
    await expect.poll(async () => await back.isVisible() || await map.isVisible(), { timeout: 60_000 }).toBe(true);
    if (await back.isVisible()) await back.click();
    await expect(map).toHaveAttribute('aria-busy', 'false');
    const merchant = page.locator('[data-life-resident="shipment:merchant"]'), guard = page.locator('[data-life-resident="shipment:guard"]');
    await expect(merchant).toBeVisible(); await expect(guard).toBeVisible();
    const painting = () => page.evaluate(async () => (await import('/src/lib/sector-life-art.ts')).sectorLifePainting(2));
    const snap = async (stage: string) => { await page.clock.runFor(300); await page.mouse.move(2, 2); await map.screenshot({ path: `${evidence}/${info.project.name}-${mode}-${stage}.png` }); };
    await expect.poll(painting).toBe(`/sector-life/${P.spilled}.webp`);
    await snap('fallen-bundles');
    await guard.click(); await expect(page.getByRole('dialog')).toContainText('Keep the crossing clear. This is a Stormveil road.');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const point = page.locator('.sector-life-point'), dialog = page.getByRole('dialog');
    await point.click();
    if (mode !== 'unattended') {
        await dialog.getByRole('button', { name: 'Inspect the bundles', exact: true }).click();
        await expect(dialog).toContainText(L.inspected);
        await dialog.getByRole('button', { name: 'Secure the bundles', exact: true }).click();
        await expect(dialog).toContainText(L.waiting); expect(posts).toBe(2);
        if (mode === 'cached outage') offline = true;
    }
    const plan = dockShipmentPlan(state, LIFE_WINDOW_MS, LIFE_ACTIVE_MS);
    await page.clock.setSystemTime(new Date(bootAt));
    // Keep actual walking frames. A jump straight to arrival would certify
    // dialogue while the navigator was still catching up from the east road.
    if (mode === 'unattended') {
        await page.clock.runFor(2500); await expect(dialog).toContainText(L.unattended);
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    } else {
        await dialog.getByRole('button', { name: 'Walk to the work point', exact: true }).click();
    }
    await page.clock.runFor(7500); await expect(merchant).toHaveAttribute('data-activity', 'Taking the shipment to the docks');
    await expect.poll(painting).toBe('/sector-life/north-docks-work-stop-v1.webp'); await snap('carrying');
    await page.clock.runFor(24_000);
    await expect(merchant).toHaveAttribute('data-activity', 'Checking the delivered bundles');
    await expect.poll(painting).toBe(`/sector-life/${P.delivered}.webp`);
    await expect(guard).toBeHidden();
    expect(await page.locator('[data-life-resident]').count()).toBeLessThanOrEqual(5);
    await snap('delivered');
    await merchant.click();
    await expect(dialog).toContainText(mode === 'unattended' ? L.merchantAlone : L.merchantThanks);
    await dialog.screenshot({ path: `${evidence}/${info.project.name}-${mode}-delivery-dialogue.png` });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await point.click(); await expect(dialog).toContainText(mode === 'unattended' ? L.unhelpedDelivery : L.delivered);
    if (mode === 'aided') {
        await dialog.getByRole('button', { name: 'Check the delivered bundles', exact: true }).click();
        await expect(dialog).toContainText(L.complete); expect(posts).toBe(3);
    }
    // Static rest may be skipped; the onward road leg still gets real frames.
    await page.clock.fastForward(plan.leavesAt + 100 - await page.evaluate(() => Date.now()));
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.clock.runFor(plan.hideAt - plan.leavesAt + 3000);
    await expect(merchant).toBeHidden(); await snap('departed');
    if (mode === 'cached outage') {
        const before = polls;
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.fastForward(plan.end + 1000 - await page.evaluate(() => Date.now())); expect(polls).toBe(before);
        await page.evaluate(() => { delete (document as Document & { hidden?: boolean }).hidden; document.dispatchEvent(new Event('visibilitychange')); });
        await page.clock.runFor(1000);
        await expect.poll(painting).toBe('/sector-life/north-docks-work-stop-v1.webp');
        await point.click(); await expect(dialog).toContainText(L.ended);
        await expect(dialog.getByRole('button', { name: 'Check the delivered bundles', exact: true })).toHaveCount(0);
        await snap('expired-after-outage');
    }
    expect(errors).toEqual([]);
});

for(const phase of ['spilled','delivered','landscape'] as const)test(`dock shipment layout: ${phase}`,async({page},info)=>{
    if(phase==='landscape'){test.skip(info.project.name!=='phone','the phone landscape viewport');await page.setViewportSize({width:844,height:390});}
    const kind=phase==='spilled'?'spilled':'delivered';
    const now=300*LIFE_WINDOW_MS+120_000;
    const state={...parseLifeState(null,now),scenario:DOCK_SHIPMENT_SCENARIO,...(kind==='delivered'?{step:2,shipmentAt:now-DOCK_SHIPMENT_DELIVERY_MS-10_000,contributors:['auditninja']}:{} )};
    await page.clock.install({time:new Date(now)});await page.clock.setFixedTime(new Date(now));
    const save=uiAuditSave();save.currentSector=2;save.currentTile=kind==='spilled'?68:101;
    save.character={...save.character,starterCardsClaimed:true,wandererCooldowns:quietRoadCooldowns([2],now)};
    await installUiAuditRuntime(page,save);await page.addInitScript(()=>localStorage.setItem('legacyRumors.seen.v1:auditninja',JSON.stringify([10,20,30,40,45])));
    await page.route('**/api/sector/life**',route=>route.fulfill({json:{ok:true,serverNow:now,view:lifeSceneView(2,state,now,'clear')}}));
    await page.goto('/#/worldMap');const map=page.locator('.continuous-world-map'),back=page.getByRole('button',{name:'Return to Sector 2',exact:false});
    await expect.poll(async()=>await back.isVisible()||await map.isVisible(),{timeout:60_000}).toBe(true);if(await back.isVisible())await back.click();
    await expect(map).toHaveAttribute('aria-busy','false');await expect(page.locator('[data-life-resident="shipment:merchant"]')).toBeVisible();
    await expect.poll(()=>page.evaluate(async()=>(await import('/src/lib/sector-life-art.ts')).sectorLifePainting(2))).toBe(`/sector-life/${P[kind]}.webp`);
    await page.clock.runFor(4000);
    // The building name must leave NPC names and native portraits readable.
    // This catches the mobile overlap found in the full delivery captures.
    await expect.poll(()=>page.locator('.sector-ground-stronghold .sector-ground-landmark-label').evaluate(label=>{
        const a=label.getBoundingClientRect();
        return Array.from(document.querySelectorAll('[data-life-resident] .sector-wanderer-label,[data-life-resident] .sector-avatar-body')).every(node=>{
            const b=node.getBoundingClientRect();return !b.width||!b.height||a.right+1<=b.left||b.right+1<=a.left||a.bottom+1<=b.top||b.bottom+1<=a.top;
        });
    })).toBe(true);
    await expect.poll(()=>page.locator('.sector-wanderer-label,.sector-wanderer-bubble').evaluateAll(labels=>{
        const obstacles=[...document.querySelectorAll('[data-world-self] .sector-avatar-body,.resource-world-node')].map(node=>node.getBoundingClientRect());
        return labels.every(label=>{const r=label.getBoundingClientRect();return !r.width||!r.height||obstacles.every(body=>r.right<=body.left||body.right<=r.left||r.bottom<=body.top||body.bottom<=r.top);});
    })).toBe(true);
    await map.screenshot({path:`${evidence}/${info.project.name}-layout-${phase}.png`});
});
