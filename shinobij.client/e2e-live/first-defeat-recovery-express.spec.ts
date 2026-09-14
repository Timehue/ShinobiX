import { expect, type Route } from '@playwright/test';
import { API_CONNECTION_RETRIES, test } from './helpers/reconnecting-request';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';

// Keep review artifacts focused on the persistent consequence, without copying
// combat tokens or the full game/content catalog into every evidence file.
function evidenceRecord(value: unknown): Record<string, unknown> {
 return value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
}
function stateEvidence(value: unknown) {
 const data = evidenceRecord(value);
 const character = evidenceRecord(data.character);
 return {
  _saveVersion: data?._saveVersion, currentSector: data?.currentSector,
  character: data.character && Object.fromEntries([
   'name', 'level', 'hp', 'maxHp', 'chakra', 'maxChakra', 'stamina', 'maxStamina',
   'ryo', 'xp', 'hospitalized', 'hospitalizedAt', 'hospitalizedUntil', 'lastDischargeAt', 'inventory', 'itemStacks',
  ].map(key => [key, character[key]])),
 };
}
function responseEvidence(value: unknown) {
 if (!value) return value;
 const body = evidenceRecord(value);
 const session = evidenceRecord(body.session);
 const metadata = evidenceRecord(evidenceRecord(session.encounter).metadata);
 return {
  ...stateEvidence(body), ok: body.ok, error: body.error, reason: body.reason,
  chargedRyo: body.chargedRyo, alreadyDischarged: body.alreadyDischarged,
  replayed: body.replayed, retryAfterMs: body.retryAfterMs,
  session: body.session && {
   id: session.id, version: session.version, phase: session.phase,
   continuousVitals: metadata.continuousVitals,
   player: stateEvidence({ character: session.player }).character,
  },
 };
}

// Real player handlers with deterministic account/exploration fixtures. No
// terminal combat, healing, wallet, or save responses are fabricated.
for (const recovery of ['paid', 'free', 'healer', 'external', 'external-stale', 'paid-lost', 'paid-timeout', 'terminal-lost', 'poor'] as const) {
test(`persistent world defeat and recovery: ${recovery}`, async ({ page, request, context }, info) => {
 test.setTimeout(180000);
 const name = `defeat${info.project.name.includes('mobile') ? 'm' : 'd'}${Date.now().toString(36)}`;
 const password = 'DefeatJourney!1234';
 const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password } });
 expect(registered.status(), await registered.text()).toBe(200);
 const { token } = await registered.json();
 const headers = { 'x-player-name': name, 'x-player-token': token };
 const receipt = 'defeat-explore-receipt-001';
 const character = {
  name, village: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None', level: 3, rankTitle: 'Academy Student', xp: 0, ryo: recovery === 'poor' ? 100 : 10000,
  hp: 40, maxHp: 700, chakra: 35, maxChakra: 1181, stamina: 45, maxStamina: 1181, unspentStats: 0,
  stats: Object.fromEntries(['strength','speed','intelligence','willpower','bukijutsuOffense','bukijutsuDefense','taijutsuOffense','taijutsuDefense','genjutsuOffense','genjutsuDefense','ninjutsuOffense','ninjutsuDefense'].map(key => [key, 20])),
  onboardingStep: 'done', profession: recovery === 'healer' ? 'healer' : 'vanguard', professionChosenAt: 1, inventory: [], itemStacks: [], equipment: {}, pets: [], jutsuMastery: [], equippedJutsuIds: [],
  redeemedSectorExplorations: [{ id: receipt, sector: 51, at: Date.now(), outcome: { kind: 'battle' } }],
 };
 const seeded = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: { character, currentSector: 51, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: ['builtin-awakening-lv2','builtin-aura-sphere-lv9','builtin-hidden-dungeon'] } });
 expect(seeded.status(), await seeded.text()).toBe(200);
 const save = async () => { const r = await request.get(`/api/save/${name}`, { headers }); expect(r.status()).toBe(200); return r.json(); };
 await save(); // Apply the owner-read migration before recording the fixture.
 let before = await save();
 const sector = before.currentSector;
 // The owner-read travel migration chooses the canonical spawn sector. Bind
 // the prepared ambush receipt to that actual location, never a guessed one.
 const bound = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: { ...before, character: { ...before.character, redeemedSectorExplorations: [{ id: receipt, sector, at: Date.now(), outcome: { kind: 'battle' } }] } } });
 expect(bound.status()).toBe(200);
 before = await save();
 await request.post(`/api/save/${name}?ack=1`, { headers });
 await context.addInitScript(({ name, token, before, patch, mobile }) => {
  if (mobile) sessionStorage.setItem('shinobix:surface.v1', 'play-app');
  if (!localStorage.getItem('defeat-qa-installed')) {
   localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
   localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
   localStorage.setItem('shinobix:activePlayerPersist', name); localStorage.setItem('shinobix:activeTokenPersist', token);
   localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(before));
   localStorage.setItem('shinobix:storage-notice-ack', '1'); localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
   localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10)); localStorage.setItem('defeat-qa-installed', '1');
  }
 }, { name, token, before, patch: LATEST_PATCH_NOTE.version, mobile: info.project.name.includes('mobile') });
 const directory = process.env.DEFEAT_PHASE
  ? resolve('..', 'docs/audits/first-defeat-recovery', process.env.DEFEAT_PHASE, info.project.name + '-' + recovery)
  : info.outputPath('journey');
 mkdirSync(directory, { recursive: true });
 const events: Record<string, unknown>[] = [{ moment: 'before', save: before }];
 const capture = async (label: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: resolve(directory, label + '.png'), fullPage: true });
  writeFileSync(resolve(directory, label + '.txt'), await page.locator('body').innerText());
 };
 page.on('dialog', async d => { events.push({ dialog: d.message() }); await d.accept(); });
 page.on('response', async r => { if (r.url().includes('/report-ai-fight') || r.url().includes('/player/heal')) events.push({ url: r.url(), status: r.status(), body: await r.json().catch(() => null) }); });
 try {
  await page.goto('/#/worldMap');
  await expect(page.locator('.anime-world-map')).toBeVisible();
  await capture('01-before');
  const entering = await save(); events.push({ moment: 'immediatelyBeforeCombat', save: entering });
  expect(entering.currentSector).toBe(sector);
  expect(entering.character.hospitalized).not.toBe(true);
  const start = await request.post('/api/missions/ai-fight-start', { headers, data: { playerName: name, battleKind: 'explore', sector, worldExploreRequestId: receipt } });
  const started = await start.json(); events.push({ moment: 'start', status: start.status(), body: started });
  expect(start.status(), JSON.stringify(started)).toBe(200);
  expect(started.session.encounter.metadata.continuousVitals).toBe(true);
  for (const vital of ['hp', 'chakra', 'stamina']) {
   expect(started.session.player[vital]).toBeGreaterThanOrEqual(entering.character[vital]);
   expect(started.session.player[vital]).toBeLessThanOrEqual(entering.character[vital] + 2);
  }
  await page.reload();
  await expect(page.locator('.mission-arena-fight')).toBeVisible();
  if (info.project.name.includes('mobile')) {
   await page.evaluate(() => { history.pushState(null, '', '#/village'); history.back(); });
   await expect(page.locator('.mission-arena-fight')).toBeVisible();
  }
  await capture('02-combat');
  let terminalDropped = false;
  if (recovery === 'terminal-lost') {
   await page.route('**/api/missions/report-ai-fight', async route => {
    if (terminalDropped) { await route.abort(); return; }
    const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
    events.push({ moment: 'terminalResponseLost', body: await response.json() });
    terminalDropped = true;
    await route.abort();
   });
  }
  for (let turn = 0; turn < 24 && await page.getByRole('dialog', { name: 'Fight lost', exact: true }).count() === 0; turn++) {
   const wait = page.locator('.mission-arena-fight').getByRole('button', { name: /End Turn|Wait/ }).first();
   if (await wait.count()) { await wait.click(); await page.waitForTimeout(900); }
   else { await capture('02-combat-no-wait'); throw new Error('No wait command'); }
  }
  await expect(page.getByRole('dialog', { name: 'Fight lost', exact: true })).toBeVisible();
  await capture('03-defeat');
  if (recovery === 'terminal-lost') {
   await expect.poll(() => terminalDropped).toBe(true);
   await page.unroute('**/api/missions/report-ai-fight');
   await page.reload();
  } else {
   const result = page.getByRole('dialog', { name: 'Fight lost', exact: true });
   await expect(result).toContainText('Your HP reached zero');
   const proceed = result.getByRole('button', { name: 'Go to Hospital', exact: true });
   await proceed.focus(); await expect(proceed).toBeFocused(); await proceed.press('Enter');
   await expect(result).toHaveCount(0);
  }
  await expect(page.locator('.hospital-screen--admitted')).toBeVisible(); await capture('04-hospital');
  await expect(page.getByRole('dialog', { name: 'Notice', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const settled = await save(); events.push({ moment: 'settled', save: settled });
  expect(settled.character.hp).toBe(0);
  expect(settled.character.hospitalized).toBe(true);
  expect(settled.character.ryo).toBe(character.ryo);
  expect(settled.currentSector).toBe(0);
  await page.reload(); await expect(page.locator('.hospital-screen--admitted')).toBeVisible(); await capture('05-hospital-reload');
  await page.getByRole('button', { name: 'Travel', exact: true }).click();
  const rejection = page.getByRole('alertdialog');
  await expect(rejection).toContainText("You're still admitted");
  await rejection.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator('.hospital-screen--admitted')).toBeVisible();
  // A deep link and the Play history path cannot release the admitted player.
  await page.goto('/#/worldMap'); await page.reload();
  await expect(page.locator('.hospital-screen--admitted')).toBeVisible();
  if (info.project.name.includes('mobile')) {
   await page.evaluate(() => { history.pushState(null, '', '#/village'); history.back(); });
   await expect(page.locator('.hospital-screen--admitted')).toBeVisible();
  }
  const stalePost = await request.post(`/api/save/${name}`, { headers, data: { ...before, _baseSaveVersion: before._saveVersion, _saveRequestId: `stale-before-${Date.now()}` } });
  events.push({ moment: 'stalePreDefeatSave', status: stalePost.status(), body: await stalePost.json() });
  expect(stalePost.status()).toBe(409);
  expect((await save()).character.hospitalized).toBe(true);
  const invalid = await request.post('/api/missions/ai-fight-start', { headers, data: { playerName: name, battleKind: 'practice', opponentId: 'builtin-ai-academy-sparring' } });
  events.push({ moment: 'invalid', status: invalid.status(), body: await invalid.json() }); expect(invalid.status()).toBe(409);
  if (recovery === 'external-stale' || recovery === 'external') {
   await page.route('**/api/player/heartbeat', route => route.abort());
   const healerName = name + 'medic';
   const reg = await request.post('/api/player-auth', { data: { action: 'register', name: healerName, password } });
   const healerToken = (await reg.json()).token;
   const snapshot = await save();
   await request.post(`/api/save/${healerName}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: { ...snapshot, character: { ...snapshot.character, name: healerName, profession: 'healer', professionXp: 0, chakra: 1181, hp: 700, hospitalized: false, hospitalizedUntil: 0 } } });
   const healed = await request.post('/api/player/heal', { headers: { 'x-player-token': healerToken }, data: { healerName, targetName: name, requestId: `defeat-external-${name}` } });
   expect(healed.status(), await healed.text()).toBe(200);
   events.push({ moment: 'externalHealed', save: await save() });
   if (recovery === 'external') {
    // A real owner read wins before the queued healer notice. Recovery feedback
    // and the village exit must still run when that notice is finally delivered.
    await page.reload();
    await expect(page.locator('.hospital-screen')).toBeVisible();
    await expect(page.locator('.hospital-screen--admitted')).toHaveCount(0);
    await page.unroute('**/api/player/heartbeat');
    await expect(page).toHaveURL(/#\/village$/, { timeout: 20000 });
   } else {
   // A fresh admission while the actual healer notification remains undelivered.
   const healedSave = await save();
   await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: { ...healedSave, character: { ...healedSave.character, hp: 0, hospitalized: true, hospitalizedAt: Date.now() + 1, hospitalizedUntil: Date.now() + 60001 } } });
   await request.post(`/api/save/${name}?ack=1`, { headers });
   await page.unroute('**/api/player/heartbeat');
   await page.reload();
   await expect(page.locator('.hospital-screen--admitted')).toBeVisible();
   // Observe several real heartbeats, including delivery of the old signal.
   await page.waitForTimeout(3500);
   await expect(page.locator('.hospital-screen--admitted')).toBeVisible();
   await capture('08-stale-healer-signal');
   const authoritative = await save(); events.push({ moment: 'staleSignal', save: authoritative });
   expect(authoritative.character.hospitalized).toBe(true);
   await page.getByRole('button', { name: 'Pay & discharge', exact: true }).click();
   }
  } else if (recovery === 'free' || recovery === 'poor') {
   if (recovery === 'poor') {
    await expect(page.getByRole('button', { name: 'Pay & discharge', exact: true })).toBeDisabled();
    await expect(page.locator('.hospital-screen--admitted')).toContainText('short 2,400 ryo');
    const refused = await request.post('/api/player/heal', { headers, data: { targetName: name, paySkip: true, hospitalizedAt: settled.character.hospitalizedAt } });
    expect(refused.status()).toBe(402);
    expect((await save()).character.ryo).toBe(100);
   }
   await expect(page.locator('.hospital-screen--admitted')).toHaveCount(0, { timeout: 80000 });
  } else if (recovery === 'healer') {
   await page.locator('.hospital-screen--admitted').getByRole('button', { name: 'Self-heal & discharge', exact: true }).click();
  } else if (recovery === 'paid-lost' || recovery === 'paid-timeout') {
   let dropped = false;
   let stalledRoute: Route | undefined;
   await page.route('**/api/player/heal', async route => {
    if (dropped) { await route.continue(); return; }
    dropped = true;
    if (recovery === 'paid-timeout') {
     stalledRoute = route;
     return; // The client's real 12-second deadline must release its busy state.
    } else {
     const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
     events.push({ moment: 'lostHealResponse', body: await response.json() });
    }
    await route.abort();
   });
   await page.getByRole('button', { name: 'Pay & discharge', exact: true }).click();
   await expect(page.getByRole('alert').filter({ hasText: 'Discharge could not be confirmed' })).toBeVisible({ timeout: 25000 });
   await capture('09-paid-response-lost');
   await stalledRoute?.abort().catch(() => {});
   await page.getByRole('button', { name: 'Pay & discharge', exact: true }).click();
   if (recovery === 'paid-lost') await expect(page.getByText(/Discharge confirmed\. HP restored/)).toBeVisible();
  } else {
   await page.locator('.hospital-screen--admitted').getByRole('button', { name: 'Pay & discharge', exact: true }).dblclick();
  }
  await expect(page.locator('.hospital-screen--admitted')).toHaveCount(0);
  await expect(page.locator('.stormveil-village-screen')).toBeVisible();
  await capture('06-recovered');
  const recovered = await save(); events.push({ moment: 'recovered', save: recovered });
  const expectedCharge = ['paid', 'paid-lost', 'paid-timeout', 'terminal-lost', 'external-stale'].includes(recovery) ? 2500 : 0;
  expect(recovered.character.ryo).toBe(character.ryo - expectedCharge);
  expect(recovered.character.hp).toBe(recovered.character.maxHp);
  expect(recovered.character.hospitalized).toBe(false);
  expect(recovered.character.hospitalizedUntil).toBe(0);
  expect(recovered.character.chakra).toBeLessThan(recovered.character.maxChakra);
  expect(recovered.character.stamina).toBeLessThan(recovered.character.maxStamina);
  // Replaying combat after treatment must not resurrect the defeat.
  const replay = await request.post('/api/missions/report-ai-fight', { headers, data: { playerName: name, aiFightToken: started.token } });
  events.push({ moment: 'terminalReplayAfterRecovery', status: replay.status(), body: await replay.json() });
  expect((await save()).character.hospitalized).toBe(false);
  const staleAdmission = await request.post(`/api/save/${name}`, { headers, data: { ...settled, _baseSaveVersion: settled._saveVersion, _saveRequestId: `stale-admitted-${Date.now()}` } });
  events.push({ moment: 'staleHospitalSave', status: staleAdmission.status() });
  expect(staleAdmission.status()).toBe(409);
  expect((await save()).character.hospitalized).toBe(false);
  await expect(page).toHaveURL(/#\/village$/);
  if (recovery === 'terminal-lost') {
   // Reproduce the observed ordering: an old admitted preview, a delayed owner
   // read, and a newer real achievement mutation arriving before that read.
   await page.evaluate(({ name, settled }) => {
    localStorage.setItem(`ninjav-save-preview-v1:${name}`, JSON.stringify({ ...settled, character: { ...settled.character, unlockedAchievements: undefined } }));
   }, { name, settled });
   await page.route(`**/api/save/${name}`, async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch({ maxRetries: API_CONNECTION_RETRIES });
    events.push({ moment: 'ownerReadHeld', body: await response.json() });
    await page.waitForTimeout(1500);
    await route.fulfill({ response });
    events.push({ moment: 'ownerReadReleased' });
   });
   const achievement = page.waitForResponse(r => r.url().includes('/api/achievements/sync') && r.status() === 200);
   await page.reload();
   const response = await achievement;
   const synced = await response.json();
   expect(synced.character.hospitalized).toBe(false);
   events.push({ moment: 'achievementRefreshRace', body: synced });
  } else { await page.reload(); }
  await expect(page.getByRole('button', { name: 'Travel', exact: true })).toBeVisible();
  await expect(page.locator('.hospital-screen--admitted')).toHaveCount(0);
  await capture('07-recovered-reload');
  await page.unrouteAll({ behavior: 'wait' });
  events.push({ moment: 'recoveredReload', save: await save() });
  const otherTab = await context.newPage();
  await otherTab.goto('/#/hospital');
  await expect(otherTab.locator('.hospital-screen')).toBeVisible();
  await expect(otherTab.locator('.hospital-screen--admitted')).toHaveCount(0);
  await otherTab.close();
  // Return to the world, open another permitted activity, then really log out
  // and log back in rather than restoring the fixture's local session again.
  await page.getByRole('button', { name: 'Travel', exact: true }).click();
  await expect(page.locator('.anime-world-map')).toBeVisible();
  const nextActivity = await request.post('/api/missions/ai-fight-start', { headers, data: { playerName: name, battleKind: 'practice', opponentId: 'builtin-ai-academy-sparring' } });
  const nextFight = await nextActivity.json();
  expect(nextActivity.status(), JSON.stringify(nextFight)).toBe(200);
  // The established abandon action costs HP but need not hospitalize a survivor.
  const abandoned = await request.post('/api/solo-pve/action', { headers, data: { playerName: name, sessionId: nextFight.sessionId, expectedVersion: nextFight.session.version, moveToken: 'recovery-next-activity-abandon', type: 'abandon' } });
  expect(abandoned.status(), await abandoned.text()).toBe(200);
  await page.reload();
  const survived = page.getByRole('dialog', { name: 'Fight lost', exact: true });
  await expect(survived).toContainText('HP remaining');
  await expect(survived).not.toContainText('brought to the hospital');
  await survived.getByRole('button', { name: 'Return', exact: true }).click();
  const afterActivity = await save();
  expect(afterActivity.character.hospitalized).toBe(false);
  expect(afterActivity.character.hp).toBeGreaterThan(0);
  expect(afterActivity.character.hp).toBeLessThan(afterActivity.character.maxHp);
  events.push({ moment: 'nextActivity', save: afterActivity });
  // Logout's required save can still meet the save-burst limit when an autosave
  // lands inside the wait. A 429 opens "Save temporarily paused" and any other
  // failure opens "Save Failed" (lib/logout-save-failure.ts). Retry through
  // "Stay in game", as both dialogs tell the player to. "Log out anyway" would
  // discard the progress this test goes on to check.
  const loggedOut = page.getByTestId('start-create');
  const logoutBlocked = page.getByRole('alertdialog', { name: /Save temporarily paused|Save Failed/ });
  for (let attempt = 0; attempt < 3; attempt++) {
   await page.waitForTimeout(3100); // ordinary save-burst bucket before logout
   if (info.project.name.includes('mobile')) {
    if (!await page.getByRole('dialog', { name: 'Shinobi menu' }).isVisible()) {
     await page.locator('.mobile-bottom-nav').getByRole('button', { name: 'Menu', exact: true }).click();
    }
    await page.getByRole('dialog', { name: 'Shinobi menu' }).getByRole('button', { name: 'Logout' }).click();
   } else { await page.getByRole('button', { name: 'Logout', exact: true }).click(); }
   await expect(loggedOut.or(logoutBlocked)).toBeVisible();
   if (await loggedOut.isVisible()) break;
   events.push({ moment: 'logoutProtectedRetry', attempt });
   await logoutBlocked.getByRole('button', { name: 'Stay in game', exact: true }).click();
   await expect(logoutBlocked).toHaveCount(0);
  }
  await expect(loggedOut).toBeVisible();
  await page.locator('.landing-topnav').getByRole('button', { name: 'Log In', exact: true }).click();
  await page.getByRole('button', { name: 'Use a name and password' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByPlaceholder('Enter your password').fill(password);
  const loginSave = page.waitForResponse(r => new URL(r.url()).pathname === `/api/save/${name}` && r.request().method() === 'GET' && r.status() === 200);
  await page.getByRole('button', { name: 'Enter Village' }).click();
  await loginSave;
  await expect(page.getByTestId('start-create')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Travel', exact: true })).toBeVisible();
  await expect(page.locator('.hospital-screen--admitted')).toHaveCount(0);
  const loggedIn = await save(); events.push({ moment: 'loggedInAgain', save: loggedIn });
  expect(loggedIn.character.hospitalized).toBe(false);
  expect(loggedIn.character.ryo).toBe(character.ryo - expectedCharge);
  await capture('10-login-again');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
 } finally {
  writeFileSync(resolve(directory, 'evidence.json'), JSON.stringify(events.map(({ save: snapshot, body, ...event }) => ({
   ...event, ...(snapshot ? { save: stateEvidence(snapshot) } : {}), ...(body ? { body: responseEvidence(body) } : {}),
  })), null, 2));
 }
});
}
