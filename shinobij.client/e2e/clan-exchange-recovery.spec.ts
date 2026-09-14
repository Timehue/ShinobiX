import {expect, test} from '@playwright/test';
import {installUiAuditRuntime, uiAuditSave} from './helpers/ui-audit-runtime';

function currentWeek() {
    const date = new Date();
    const day = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
    day.setUTCDate(day.getUTCDate()+4-(day.getUTCDay()||7));
    const week = Math.ceil(((day.getTime()-Date.UTC(day.getUTCFullYear(),0,1))/86400000+1)/7);
    return `${day.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}

for (const scenario of ['paid', 'reconnect', 'unpaid'] as const) {
test(`Exchange ${scenario}: recovery stays reachable with exhausted points and weekly stock`, async ({page}) => {
    const requestId = `cex-${Date.now()}-${'e'.repeat(32)}`;
    const storageKey = `shinobix.clan-exchange:${JSON.stringify(['auditninja', 'shadow cell', 'greaterWarSupplyGrant'])}`;
    const save = uiAuditSave();
    save.character = {...save.character, clan:'Shadow Cell', clanFounder:true, clanPoints:0,
        clanExchangePurchases:{weekly:{[currentWeek()]:{greaterWarSupplyGrant:1}}},
        clanExchangeSettlements:[{requestId, transactionId:'paid-exchange', fingerprint:'sealed', proofToken:'private-server-owner',
            clanSlug:'shadowcell', createdAt:Date.now(), item:{id:'greaterWarSupplyGrant'}, purchaseCount:1, remaining:0}]};
    if (scenario === 'unpaid') save.character.clanExchangeSettlements = [];
    const alerts: string[] = [];
    page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.dismiss(); });
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(({key,id}) => sessionStorage.setItem(key,id), {key:storageKey,id:requestId});
    const clan = {name:'Shadow Cell', village:'Stormveil Village', founderName:'AuditNinja', level:25, xp:300,
        treasury:{ryo:25000,warSupply:10,items:[]}, createdAt:Date.now()-86400000,
        members:[{name:'AuditNinja',level:85,village:'Stormveil Village',isFounder:true,month:new Date().toISOString().slice(0,7)}],
        roleOverrides:{},joinRequests:[],notices:[],warHistory:[]};
    await page.route('**/api/save/clan-shadowcell', route => route.fulfill({json:clan}));
    const requests: Record<string,unknown>[] = [];
    await page.route('**/api/clan/exchange/purchase', async route => {
        requests.push(route.request().postDataJSON() as Record<string,unknown>);
        if (scenario === 'reconnect' && requests.length === 1) {
            await route.fulfill({status:500,json:{error:'Interrupted settlement'}});
            return;
        }
        const version = runtime.currentVersion()+1;
        runtime.commitServerCharacter(save.character!,version);
        await route.fulfill({json:{ok:true,character:save.character,_saveVersion:version,
            clan:{xp:300,level:25,treasury:{...clan.treasury,warSupply:1510}},
            item:{id:'greaterWarSupplyGrant'},purchaseCount:1,remaining:0}});
    });
    const interruption = scenario === 'reconnect'
        ? page.waitForResponse(response => response.url().includes('/api/clan/exchange/purchase') && response.status() === 500)
        : null;
    await page.goto('/#/clan',{waitUntil:'domcontentloaded'});
    await expect(page.getByRole('heading',{name:'Shadow Cell'})).toBeVisible();
    const hint = page.locator('.screen-hint-dismiss');
    if (await hint.isVisible()) await hint.click();
    await page.getByRole('button',{name:'Exchange',exact:true}).click();
    await expect(page.locator('.clan-exchange')).toBeVisible();
    if (scenario === 'unpaid') {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(requests).toHaveLength(0);
        expect(await page.evaluate(key=>sessionStorage.getItem(key),storageKey)).toBe(requestId);
        return;
    }
    await expect.poll(()=>requests.length).toBe(1);
    if (scenario === 'reconnect') {
        await (await interruption)?.finished();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(await page.evaluate(key=>sessionStorage.getItem(key),storageKey)).toBe(requestId);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect.poll(()=>requests.length).toBe(2);
        expect(requests[1].requestId).toBe(requestId);
    }
    expect(requests[0]).toMatchObject({playerName:'AuditNinja',clan:'Shadow Cell',itemId:'greaterWarSupplyGrant',requestId});
    await expect.poll(()=>page.evaluate(key=>sessionStorage.getItem(key),storageKey)).toBeNull();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('complementary',{name:'Device and server saves diverged'})).toHaveCount(0);
    await page.getByRole('button',{name:'Roster',exact:true}).click();
    await page.getByRole('button',{name:'Exchange',exact:true}).click();
    await expect(page.locator('.clan-exchange')).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(requests).toHaveLength(scenario === 'reconnect' ? 2 : 1);
    expect(alerts).toEqual([]);
});
}
