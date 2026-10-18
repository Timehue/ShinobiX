import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const output = resolve(import.meta.dirname, '../.tmp/pet-incubation-review');
const base = process.env.PET_INCUBATION_QA_URL ?? process.env.PET_TECHNIQUES_QA_URL ?? 'http://127.0.0.1:4329';
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body style="margin:0;background:#07101d"><div id="root"></div><script type="module" src="/.tmp/pet-incubation-review/entry.tsx"></script></body></html>');
await writeFile(resolve(output, 'entry.tsx'), `import { createRoot } from 'react-dom/client';
import { useEffect, useState, useRef } from 'react';
import '../../src/styles/tokens.css'; import '../../src/styles/ui.css'; import '../../src/styles/index/01-base-app-chrome.css'; import '../../src/styles/veiled-steel.css'; import '../../src/styles/pet-home.css';
import { createCharacter } from '../../src/lib/create-character';
import { PetSanctuary } from '../../src/components/PetSanctuary';
import { PetEggIncubator } from '../../src/components/PetEggIncubator';
function Harness() {
 const [character,setCharacter] = useState(null), [blocked,setBlocked] = useState(true), [screen,setScreen] = useState('home'), [notice,setNotice] = useState(false); const version=useRef(0);
 const adopt=(next,incoming)=>{ if(incoming<version.current)return false;version.current=incoming;setCharacter({...createCharacter('incubationqa','Stormveil Village','Ninjutsu','Ashen Eyes'),...next});return true; };
 window.qaObserveVersion=value=>{version.current=value;};
 useEffect(()=>{fetch('/api/save/incubationqa').then(r=>r.json()).then(r=>adopt(r.character,r._saveVersion));},[]);
 return <><nav style={{padding:10,display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>setBlocked(true)}>Start battle</button><button onClick={()=>setBlocked(false)}>End battle</button><button onClick={()=>setScreen('dungeon')}>Start event</button><button onClick={()=>setScreen('home')}>End event</button><button onClick={()=>window.dispatchEvent(new Event('focus'))}>Refresh activity</button><button onClick={()=>setNotice(true)}>Show alert</button></nav>
<div role="alertdialog" aria-label="Current encounter" style={{display:notice?'block':'none'}}><p>Finish this encounter first.</p><button onClick={()=>setNotice(false)}>Dismiss notice</button></div>
{character&&<><PetEggIncubator character={character} onVersionedCharacter={adopt} sharedImages={{}} blocked={blocked} screen={screen}/><main className="pet-home-screen"><PetSanctuary character={character} updateCharacter={setCharacter} onVersionedCharacter={adopt} onServerVersion={()=>{}} sharedImages={{}}/></main></>}</>;
} createRoot(document.getElementById('root')).render(<Harness/>);`);
if (process.argv.includes('--prepare-only')) process.exit(0);

const browser = await chromium.launch({ headless: true });
const report = { errors: [], viewports: [] };
try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        let version = 1, hatchCalls = 0, acknowledgements = 0;
        let releaseHatch;
        const hatchGate = new Promise(resolveGate => { releaseHatch = resolveGate; });
        let holdAcknowledgement = false, releaseAcknowledgement;
        const acknowledgementGate = new Promise(resolveGate => { releaseAcknowledgement = resolveGate; });
        const activities = [];
        const sessionId = `breed-${'a'.repeat(32)}`;
        const child = { id: 'standard-0:hatched', templateId: 'standard-0', breedingSessionId: sessionId,
            name: 'Red Fox', rarity: 'standard', level: 1, element: 'Fire', trait: 'Lucky', generation: 1,
            paletteVariantId: 'chromatic-v1', jutsus: [] };
        const character = { name: 'incubationqa', pets: [], petBreeding: { sessionId, state: 'egg', parentIds: ['one', 'two'], parentNames: ['One', 'Two'],
            parentElement: 'Fire', startedAt: 1, readyAt: 1, rulesVersion: 3, location: 'sanctuary', incubationRemainingMs: 43_200_000, incubationUpdatedAt: Date.now() }, petBreedingHatchReceipts: [] };
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(90_000);
        page.on('pageerror', error => report.errors.push(error.message));
        await page.route('**/api/**', async route => {
            const path = new URL(route.request().url()).pathname;
            const send = json => route.fulfill({ json });
            if (path.startsWith('/api/save/')) return send({ character, _saveVersion: version });
            if (path === '/api/pet/breeding/status') {
                if (route.request().method() === 'POST') activities.push(route.request().postDataJSON().activity);
                return send({ ok: true, session: character.petBreeding, character, _saveVersion: ++version, serverTime: Date.now() });
            }
            if (path === '/api/pet/breeding/hatch') {
                const body = route.request().postDataJSON();
                if (body.acknowledgeReveal) {
                    acknowledgements++;
                    if (holdAcknowledgement) await acknowledgementGate;
                    character.petBreedingHatchReceipts[0].revealPending = false;
                }
                else {
                    hatchCalls++;
                    if (hatchCalls === 1) await hatchGate;
                    character.petBreeding = null;
                    if (!character.petBreedingHatchReceipts.length) character.petBreedingHatchReceipts = [{ sessionId, petId: child.id, destination: 'sanctuary', revealPending: true }];
                }
                return send({ ok: true, replayed: hatchCalls > 1, character, pet: child, destination: 'sanctuary', _saveVersion: ++version });
            }
            if (path === '/api/pet/sanctuary/list') return send({ ok: true, items: [], total: 0, nextCursor: null });
            return send({ ok: true });
        });
        await page.goto(`${base}/.tmp/pet-incubation-review/index.html`, { waitUntil: 'commit' });
        await page.getByLabel('Gameplay time remaining').waitFor();
        assert.ok((await page.getByLabel('Gameplay time remaining').innerText()).startsWith('11:59:')
            || (await page.getByLabel('Gameplay time remaining').innerText()) === '12:00:00');
        assert.equal(await page.getByText('Chromatic miracle').count(), 0, 'egg hides its palette');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Sanctuary egg fits the viewport');
        await page.screenshot({ path: resolve(output, `egg-${viewport.width}.png`), fullPage: true });
        const paused = page.waitForResponse(response => response.url().includes('/api/pet/breeding/status') && response.request().postDataJSON()?.activity?.active === false);
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
        await paused;
        assert.equal(activities.at(-1).elapsedMs, 0, 'backgrounding ends the active interval');
        const resumed = page.waitForResponse(response => response.url().includes('/api/pet/breeding/status') && response.request().postDataJSON()?.activity?.active === true);
        await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
        await resumed;
        assert.equal(activities.at(-1).elapsedMs, 0, 'resume cannot claim an offline interval');
        character.petBreeding.incubationRemainingMs = 0;
        await page.getByRole('button', { name: 'Refresh activity', exact: true }).click();
        await page.getByText('Ready to hatch.', { exact: false }).waitFor();
        assert.equal(hatchCalls, 0, 'a ready egg never interrupts a battle');
        await page.getByRole('button', { name: 'Start event', exact: true }).click();
        await page.getByRole('button', { name: 'End battle', exact: true }).click();
        assert.equal(hatchCalls, 0, 'finishing combat does not interrupt an event');
        await page.getByRole('button', { name: 'Show alert', exact: true }).click();
        await page.getByRole('button', { name: 'End event', exact: true }).click();
        assert.equal(hatchCalls, 0, 'an alert also defers the reveal');
        const hatching = page.waitForRequest(request => request.url().includes('/api/pet/breeding/hatch'));
        await page.getByRole('button', { name: 'Dismiss notice', exact: true }).click();
        await hatching;
        await page.getByRole('button', { name: 'Start battle', exact: true }).click();
        releaseHatch();
        await page.getByLabel('Gameplay time remaining').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('[data-pet-hatch-reveal]').count(), 0, 'a late response stays queued behind a newly started battle');
        await page.getByRole('button', { name: 'End battle', exact: true }).click();
        await page.getByRole('dialog', { name: 'Red Fox' }).waitFor();
        await page.getByText('Chromatic miracle').waitFor();
        assert.equal(hatchCalls, 1);
        await page.getByRole('dialog').screenshot({ path: resolve(output, `hatch-${viewport.width}.png`) });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.reload({ waitUntil: 'commit' });
        await page.getByRole('button', { name: 'End battle', exact: true }).click();
        await page.getByRole('dialog', { name: 'Red Fox' }).waitFor();
        assert.equal(hatchCalls, 2, 'the pending reveal is recovered after reconnect');
        await page.evaluate(() => window.qaObserveVersion(1000));
        await page.getByRole('button', { name: 'Welcome home', exact: true }).click();
        await page.locator('[data-pet-hatch-reveal]').waitFor({ state: 'hidden' });
        assert.equal(acknowledgements, 1);
        assert.equal(character.petBreedingHatchReceipts[0].revealPending, false);
        await page.getByRole('button', { name: 'Start battle', exact: true }).click();
        await page.getByRole('button', { name: 'End battle', exact: true }).click();
        assert.equal(hatchCalls, 2, 'a refused stale acknowledgement snapshot cannot reopen the reveal');
        character.petBreedingHatchReceipts[0].revealPending = true;
        holdAcknowledgement = true;
        await page.reload({ waitUntil: 'commit' });
        await page.getByRole('button', { name: 'End battle', exact: true }).click();
        await page.getByRole('dialog', { name: 'Red Fox' }).waitFor();
        await page.getByRole('button', { name: 'Welcome home', exact: true }).click();
        await page.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Close hatch reveal', exact: true }).isEnabled(), true);
        await page.getByRole('button', { name: 'Close hatch reveal', exact: true }).click();
        await page.locator('[data-pet-hatch-reveal]').waitFor({ state: 'hidden' });
        const acknowledged = page.waitForResponse(response => response.url().includes('/api/pet/breeding/hatch') && response.request().postDataJSON()?.acknowledgeReveal);
        releaseAcknowledgement();
        await acknowledged;
        assert.equal(character.petBreedingHatchReceipts[0].revealPending, false);
        report.viewports.push({ viewport, battleDeferred: true, eventDeferred: true, alertDeferred: true, lateResponseDeferred: true,
            backgroundPaused: true, persistedReveal: true, staleAcknowledgementHandled: true, escapeWhileSaving: true, acknowledged: true });
        await page.close();
    }
    assert.deepEqual(report.errors, []);
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
