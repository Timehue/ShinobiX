import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { rollWanderers, wandererDayBucketFromMs } from '../../shared/wanderer-roster';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';

// A verified roster window containing each service under test. The live
// six-hour roll can legitimately contain no merchant or medic anywhere.
const ENCOUNTER_TIME = Date.UTC(2026, 9, 20, 6);
type BanditTravelSample = { x: number; y: number; wallTime: number; motionTime: number; width: number };

for (const reducedMotion of ['no-preference','reduce'] as const) {
    test(`a bandit runs to the player at the authored pace (${reducedMotion})`, async ({page},info) => {
        test.setTimeout(90_000);
        await page.emulateMedia({reducedMotion});
        await page.clock.setFixedTime(ENCOUNTER_TIME);
        const sector = 24, tile = 61;
        const bandit = rollWanderers(sector,wandererDayBucketFromMs(ENCOUNTER_TIME)).find(w=>w.archetype==='bandit')!;
        expect(bandit.homeTile).toBe(64);
        const save = uiAuditSave();
        save.currentSector=sector; save.currentTile=tile; save.worldGeoV=2;
        const cooldowns=quietRoadCooldowns(Array.from({length:66},(_,i)=>i+1),ENCOUNTER_TIME);
        delete cooldowns[bandit.id];
        save.character={...save.character,wandererCooldowns:cooldowns};
        await installUiAuditRuntime(page,save);
        await page.route('**/api/world/sector-layout',r=>r.fulfill({json:{obstaclesEnabled:true,playerGaitsEnabled:true}}));
        await page.addInitScript(({ name, sector, animated }) => {
            localStorage.setItem('legacyRumors.seen.v1:auditninja','[10,20,30,40,45]');
            const samples: BanditTravelSample[] = [];
            let frameTime: number | undefined;
            let motionTime = 0;
            const requestFrame = window.requestAnimationFrame;
            if (animated) {
                window.requestAnimationFrame = callback => requestFrame.call(window, time => {
                    if (time !== frameTime) {
                        // A suspension over one second consumes one bounded
                        // 50 ms step. Ordinary late frames keep their full time.
                        const elapsed = frameTime === undefined ? 0 : time - frameTime;
                        motionTime += elapsed > 1_000 ? 50 : elapsed;
                        frameTime = time;
                    }
                    callback(time);
                });
            }
            const chunk = `.continuous-world-chunk[data-world-chunk="${sector}"]`;
            const recorder = new MutationObserver(records => {
                const figures = new Set<HTMLElement>();
                for (const { target } of records) {
                    if (target instanceof HTMLElement && target.classList.contains('sector-wanderer-figure')
                        && target.title.startsWith(`${name} · Lv `)) figures.add(target);
                }
                for (const figure of figures) {
                    const grid = figure.closest(chunk);
                    const offset = figure.style.transform.match(/^translate\(([-.\d]+)px,\s*([-.\d]+)px\)/);
                    if (!grid || !offset) continue;
                    const x = Number(offset[1]), y = Number(offset[2]);
                    const last = samples.at(-1);
                    if (last && x === last.x && y === last.y) continue;
                    const width = grid.getBoundingClientRect().width;
                    if (!width) continue;
                    const wallTime = frameTime ?? performance.now();
                    const sample = { x, y, wallTime, motionTime: animated ? motionTime : wallTime, width };
                    if (last?.motionTime === sample.motionTime) samples[samples.length - 1] = sample;
                    else samples.push(sample);
                }
            });
            // Capture writes from the moving figure directly. A separate frame
            // callback can miss the figure when the encounter replaces it.
            recorder.observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });
            Object.assign(window, { readBanditTravel: () => {
                recorder.disconnect();
                if (animated) window.requestAnimationFrame = requestFrame;
                return samples;
            } });
        }, { name: bandit.name, sector, animated: reducedMotion === 'no-preference' });
        await page.goto('/#/worldMap');
        const back=page.getByRole('button',{name:/Return to Sector 24/});
        const map=page.locator('.continuous-world-map');
        await expect.poll(async()=>await map.isVisible()||await back.isVisible(),{timeout:30_000}).toBe(true);
        if (await back.isVisible()) await back.dispatchEvent('click');
        const pay=page.getByRole('button',{name:'Pay 500 ryo',exact:true});
        await expect(pay).toBeVisible({timeout:40_000});
        const samples = await page.evaluate(() => (window as unknown as { readBanditTravel: () => BanditTravelSample[] }).readBanditTravel());
        const lengths=samples.slice(1).map((b,i)=>{
            const a=samples[i],distance=Math.hypot(b.x-a.x,b.y-a.y)*1080/b.width;
            return {distance,seconds:(b.wallTime-a.wallTime)/1000};
        });
        await info.attach('bandit-travel.json',{body:JSON.stringify({samples,lengths}),contentType:'application/json'});
        // Measure the entire final 120 pixels in real elapsed time, including
        // delayed callbacks and waypoint crossings. motionTime is diagnostic only.
        let distance=0, seconds=0;
        for (const step of lengths.reverse()) {
            if (distance>=120) break;
            const used=Math.min(120-distance,step.distance);
            distance+=used;
            seconds+=used/step.distance*step.seconds;
        }
        expect(distance).toBe(120);
        expect(distance/seconds).toBeGreaterThan(104);
        expect(distance/seconds).toBeLessThan(136);
    });
}

for (const enoughRyo of [true, false]) test(`road bandit replaces Flee with a 500 ryo toll (${enoughRyo ? 'paid' : 'insufficient funds'})`, async ({ page }, info) => {
    const now = ENCOUNTER_TIME;
    await page.clock.setFixedTime(now);
    const bucket = wandererDayBucketFromMs(now);
    const sector = Array.from({ length: 60 }, (_, i) => i + 1).find(sector => rollWanderers(sector, bucket).some(w => w.archetype === 'bandit'))!;
    const bandit = rollWanderers(sector, bucket).find(w => w.archetype === 'bandit')!;
    const save = uiAuditSave();
    save.currentSector = sector; save.currentTile = bandit.homeTile; save.worldGeoV = 2;
    const cooldowns = quietRoadCooldowns(Array.from({ length: 66 }, (_, i) => i + 1), now);
    delete cooldowns[bandit.id];
    save.character = { ...save.character, ryo: enoughRyo ? 1500 : 499, wandererCooldowns: cooldowns };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    let payments = 0;
    await page.route('**/api/sector/road-flee', async route => {
        payments++;
        expect(route.request().postDataJSON()).toMatchObject({ kind: 'toll', sector, wandererId: bandit.id });
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(enoughRyo
            ? { ok: true, cost: { hp: 0, ryo: 500 }, totals: { hp: Number(save.character!.hp), ryo: 1000 }, _saveVersion: 2 }
            : { ok: false, reason: 'no-ryo', error: 'You need 500 ryo on hand to pay the toll.' }) });
    });
    await page.goto('/#/worldMap');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    const returnButton = page.getByRole('button', { name: new RegExp('Return to Sector ' + sector) });
    await expect.poll(async () => await returnButton.isVisible() || await page.locator('.sector-image-map').isVisible()).toBe(true);
    if (await returnButton.isVisible()) await returnButton.click();
    const pay = page.getByRole('button', { name: 'Pay 500 ryo', exact: true });
    // Open this NPC's copy through its real interaction handler. Map camera
    // hitboxes are covered by connected-sector-world; this checks the modal.
    if (!await pay.isVisible()) await page.locator('.sector-wanderer-figure').filter({ has: page.locator(`img[alt="${bandit.name}"]`) }).dispatchEvent('click');
    await expect(pay).toBeVisible();
    const card = page.locator('.card').filter({ has: pay });
    await expect(card).toHaveCSS('background-color', 'rgb(17, 24, 39)');
    await expect(card.getByRole('button', { name: 'Flee', exact: true })).toHaveCount(0);
    await expect(card).toContainText('You will not lose HP.');
    await page.screenshot({ path: info.outputPath('bandit-toll-choice.png'), fullPage: true });
    await pay.click();
    if (enoughRyo) await expect(pay).toBeHidden();
    else {
        await expect(card.getByRole('alert')).toHaveText('You need 500 ryo on hand to pay the toll.');
        await expect(card.getByRole('button', { name: 'Fight', exact: true })).toBeEnabled();
    }
    expect(payments).toBe(1);
});

for (const [archetype, action] of [['merchant', 'Buy bone charms'], ['medic', 'Pay for treatment'], ['tracker', 'Accept delivery']] as const) {
    test(`${archetype} prompt names the actual service`, async ({ page }, info) => {
        const now = ENCOUNTER_TIME;
        await page.clock.setFixedTime(now);
        const bucket = wandererDayBucketFromMs(now);
        const sector = Array.from({ length: 60 }, (_, i) => i + 1).find(sector => rollWanderers(sector, bucket).some(w => w.archetype === archetype))!;
        const npc = rollWanderers(sector, bucket).find(w => w.archetype === archetype)!;
        const save = uiAuditSave();
        save.currentSector = sector; save.currentTile = npc.homeTile; save.worldGeoV = 2;
        const cooldowns = quietRoadCooldowns(Array.from({ length: 66 }, (_, i) => i + 1), now);
        delete cooldowns[npc.id];
        save.character = { ...save.character, wandererCooldowns: cooldowns };
        await installUiAuditRuntime(page, save);
        await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
        await page.goto('/#/worldMap');
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
        const back = page.getByRole('button', { name: new RegExp('Return to Sector ' + sector) });
        await expect.poll(async () => await back.isVisible() || await page.locator('.sector-image-map').isVisible()).toBe(true);
        if (await back.isVisible()) await back.click();
        await page.locator('.sector-wanderer-figure').filter({ has: page.locator(`img[alt="${npc.name}"]`) }).dispatchEvent('click');
        await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`${archetype}-service.png`), fullPage: true });
    });
}
