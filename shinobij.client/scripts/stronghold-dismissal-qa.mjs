// Real Stronghold parents + native dialogs with delayed local route responses.
import assert from 'node:assert/strict';
const viewport = { width: 390, height: 844 };
const runKey = 'anbuInfiltration.activeRun:scout';
function gate() {
    let release, entered;
    const waiting = new Promise(resolve => { release = resolve; });
    const observed = new Promise(resolve => { entered = resolve; });
    return { observed, release, handle: async route => { entered(); const response = await waiting; await route.fulfill(response); } };
}
const accepted = state => ({ json: { ok: true, runId: 'qa-patrol', session: state.session, sector: 12, targetVillage: 'Moonshadow Village', anbu: { name: 'The Moonshadow Anbu' } } });
async function challenge(page) {
    await page.getByRole('button', { name: 'Move right', exact: true }).click();
    await page.getByRole('button', { name: 'Challenge', exact: true }).click();
}
async function attack(page) {
    await page.getByRole('button', { name: 'Inspect Rival', exact: true }).click();
    await page.getByRole('button', { name: 'Attack player', exact: true }).click();
}
async function dismiss(page, method, secondary) {
    const dialog = page.getByRole('dialog');
    assert.equal(await dialog.getAttribute('aria-busy'), 'true', 'exercise the busy dialog');
    if (method === 'Escape') await page.keyboard.press('Escape');
    else if (method === 'backdrop') await page.mouse.click(2, 2);
    else await dialog.getByRole('button', { name: method === 'secondary' ? secondary : 'Close dialog', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
}
async function pending(page, text) {
    await page.getByText(text, { exact: true }).waitFor();
    assert(await page.getByRole('button', { name: 'Leave stronghold', exact: true }).isDisabled(), 'pending request cannot race a leave');
    assert(await page.getByRole('button', { name: 'Move right', exact: true }).isDisabled(), 'pending request cannot race movement');
    await page.keyboard.press('d');
}
export async function auditStrongholdDismissal({ browser, engineName, fixture, prepare, ready }) {
    const checks = [];
    checks.push = (...items) => { for (const item of items) console.log(JSON.stringify(item)); return Array.prototype.push.apply(checks, items); };
    for (const method of ['Escape', 'Close', 'secondary', 'backdrop']) {
        const admission = gate();
        const state = fixture({ tile: 697, visited: [697], onStart: admission.handle });
        const page = await prepare(browser, viewport, state, '?host=1'); await ready(page);
        await challenge(page); await admission.observed; await dismiss(page, method, 'Retreat');
        await pending(page, 'Connecting to the Anbu fight… Closing the dialog does not cancel the challenge.');
        assert.equal(state.starts, 1); assert.equal(state.leaves, 0); assert.equal(state.steps, 0);
        admission.release(accepted(state));
        await page.locator('.hex-grid-layer').waitFor();
        assert.equal(await page.evaluate(key => localStorage.getItem(key), runKey), 'qa-patrol');
        checks.push({ engine: engineName, scenario: `Anbu busy ${method} dismissal preserves acknowledged fight`, starts: state.starts });
        await page.close();
    }
    {
        const admission = gate(); const state = fixture({ tile: 697, visited: [697], onStart: admission.handle });
        const page = await prepare(browser, viewport, state, '?host=1'); await ready(page);
        await challenge(page); await admission.observed; await dismiss(page, 'Escape');
        admission.release({ status: 409, json: { error: 'The vault is not ready.' } });
        await page.getByRole('alert').filter({ hasText: 'The vault is not ready.' }).waitFor();
        await page.waitForFunction(() => !document.querySelector('.stronghold-leave')?.disabled);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), runKey), null);
        await page.getByRole('button', { name: 'Leave stronghold', exact: true }).click();
        await page.getByRole('heading', { name: 'Returned to sector' }).waitFor();
        checks.push({ engine: engineName, scenario: 'Late definitive admission rejection remains visible and permits acknowledged leave' });
        await page.close();
    }
    {
        const admission = gate(); const state = fixture({ tile: 697, visited: [697], onStart: admission.handle });
        const page = await prepare(browser, viewport, state, '?host=1'); await ready(page);
        await challenge(page); await admission.observed; await dismiss(page, 'Escape');
        // Exercise the real API wrapper's 15s AbortSignal timeout, without a fake clock.
        await page.getByRole('button', { name: 'Reconnect to challenge', exact: true }).waitFor({ timeout: 22000 });
        assert(await page.getByRole('button', { name: 'Leave stronghold', exact: true }).isDisabled());
        assert(await page.getByRole('button', { name: 'Move right', exact: true }).isDisabled());
        state.onStart = route => route.fulfill(accepted(state));
        await page.getByRole('button', { name: 'Reconnect to challenge', exact: true }).click();
        await page.locator('.hex-grid-layer').waitFor();
        assert.equal(state.starts, 2, 'one timed-out attempt and one explicit server recovery');
        assert.equal(state.leaves, 0);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), runKey), 'qa-patrol');
        // The abandoned HTTP response cannot install another UI result.
        admission.release(accepted(state));
        checks.push({ engine: engineName, scenario: 'Real admission timeout blocks conflicting mutations and explicit retry recovers run', starts: state.starts });
        await page.close();
    }
    for (const replacement of ['unmount', 'account']) {
        const admission = gate(); const state = fixture({ tile: 697, visited: [697], onStart: admission.handle });
        const page = await prepare(browser, viewport, state, '?host=1&lifecycle=1');
        await page.getByRole('button', { name: 'Enter preview', exact: true }).click(); await ready(page);
        await challenge(page); await admission.observed; await dismiss(page, 'Escape');
        await page.getByRole('button', { name: replacement === 'unmount' ? 'Unmount preview' : 'Switch account', exact: true }).click();
        if (replacement === 'unmount') await page.getByRole('heading', { name: 'Returned to sector' }).waitFor();
        else await ready(page);
        admission.release(accepted(state));
        await page.waitForFunction(key => localStorage.getItem(key) === 'qa-patrol', runKey);
        assert.equal(await page.locator('.hex-grid-layer').count(), 0, 'old admission cannot open a fight in the new view');
        assert.equal(await page.evaluate(() => localStorage.getItem('anbuInfiltration.activeRun:other')), null);
        await page.getByRole('button', { name: replacement === 'unmount' ? 'Enter preview' : 'Switch account', exact: true }).click();
        await page.locator('.hex-grid-layer').waitFor();
        assert.equal(state.starts, 1, 'return resumes acknowledged run without a new admission');
        checks.push({ engine: engineName, scenario: `Late admission after ${replacement} remains recoverable only for original account` });
        await page.close();
    }
    for (const method of ['Escape', 'Close', 'secondary', 'backdrop']) {
        const request = gate(); const state = fixture({ onAttack: request.handle });
        const page = await prepare(browser, viewport, state, '?controlledAttack=1'); await ready(page);
        await attack(page); await request.observed; await dismiss(page, method, 'Cancel');
        await pending(page, 'Connecting to battle…');
        assert.equal(state.attacks, 1); assert.equal(state.leaves, 0); assert.equal(state.steps, 0);
        request.release({ json: { ok: true } });
        await page.waitForFunction(() => !document.querySelector('.stronghold-dpad button')?.disabled);
        checks.push({ engine: engineName, scenario: `PvP busy ${method} dismissal retains pending owner until completion` });
        await page.close();
    }
    {
        const request = gate(); const state = fixture({ onAttack: request.handle });
        const page = await prepare(browser, viewport, state, '?controlledAttack=1'); await ready(page);
        await attack(page); await request.observed; await dismiss(page, 'Escape');
        request.release({ status: 503, json: { error: 'offline' } });
        const error = page.getByRole('alert').filter({ hasText: 'Attack could not be confirmed.' }); await error.waitFor();
        const polls = state.polls;
        await page.waitForTimeout(2200);
        assert(state.polls > polls, 'presence polling resumed'); assert(await error.isVisible(), 'polling cannot erase the action failure');
        await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.stronghold-dpad button')?.disabled);
        assert.equal(state.attacks, 1, 'reconnect does not replay the attack');
        checks.push({ engine: engineName, scenario: 'Dismissed PvP error survives background polling; explicit reconnect restores controls without resubmission' });
        await page.close();
    }
    {
        const poll = gate(), request = gate();
        const state = fixture({ onState: poll.handle, onAttack: request.handle });
        const page = await prepare(browser, viewport, state, '?controlledAttack=1'); await ready(page);
        await poll.observed;
        await attack(page); await request.observed; await dismiss(page, 'Escape');
        poll.release({ status: 503, json: { error: 'Presence refresh interrupted.' } });
        const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true }); await reconnect.waitFor();
        assert(await reconnect.isDisabled(), 'presence reconnect cannot replace a submitted action owner');
        state.onState = undefined;
        request.release({ json: { ok: true } });
        await page.waitForFunction(() => !document.querySelector('.stronghold-leave')?.disabled);
        await reconnect.click();
        await page.waitForFunction(() => !document.querySelector('.stronghold-dpad button')?.disabled);
        assert.equal(state.attacks, 1);
        checks.push({ engine: engineName, scenario: 'Late polling error cannot offer a reconnect that abandons a pending action owner' });
        await page.close();
    }
    {
        const oldRequest = gate(), newRequest = gate();
        const state = fixture({ onAttack: oldRequest.handle });
        const page = await prepare(browser, viewport, state, '?controlledAttack=1&lifecycle=1');
        await page.getByRole('button', { name: 'Enter preview', exact: true }).click(); await ready(page);
        await attack(page); await oldRequest.observed; await dismiss(page, 'Escape');
        await page.getByRole('button', { name: 'Switch account', exact: true }).click(); await ready(page);
        state.onAttack = newRequest.handle;
        await attack(page); await newRequest.observed;
        oldRequest.release({ json: { ok: true } });
        await page.waitForTimeout(100);
        assert(await page.getByRole('dialog', { name: 'Rival', exact: true }).isVisible(), 'old callback cannot close the replacement dialog');
        assert(await page.getByRole('button', { name: 'Connecting…', exact: true }).isDisabled());
        await dismiss(page, 'Escape'); await pending(page, 'Connecting to battle…');
        newRequest.release({ json: { ok: true } });
        await page.waitForFunction(() => !document.querySelector('.stronghold-dpad button')?.disabled);
        checks.push({ engine: engineName, scenario: 'Late PvP completion cannot clear replacement account pending action or dialog' });
        await page.close();
    }
    {
        const leaving = gate(); const state = fixture({ onLeave: leaving.handle });
        const page = await prepare(browser, viewport, state, '?lifecycle=1');
        await page.getByRole('button', { name: 'Enter preview', exact: true }).click(); await ready(page);
        await page.getByRole('button', { name: 'Leave stronghold', exact: true }).click(); await leaving.observed;
        await page.getByRole('button', { name: 'Switch account', exact: true }).click(); await ready(page);
        leaving.release({ json: { ok: true } }); await page.waitForTimeout(100);
        assert(await page.locator('.stronghold-shell').isVisible(), 'old leave cannot exit new account view');
        assert.equal(await page.getByRole('heading', { name: 'Returned to sector' }).count(), 0);
        checks.push({ engine: engineName, scenario: 'Late leave acknowledgement cannot exit replacement account view' });
        await page.close();
    }
    return checks;
}
