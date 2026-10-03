import { buildSync } from 'esbuild';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Actual RallyControls and the shipped mapper, mounted without unrelated game
// screens, CSS, API fixtures, production data, or a running QA server.
const client = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../../.tmp/rally-controller-qa/', import.meta.url);
const source = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
assert.match(source, /import\('\.\/lib\/gamepad-navigation\.ts'\)/);
assert.match(source, /installGamepadNavigation\(\)/);
const raceSource = await readFile(new URL('../src/features/sunscar/RallyRace.tsx', import.meta.url), 'utf8');
assert.ok(raceSource.includes('data-gamepad-horizontal-select="true"'), 'actual race graphics select permits vertical focus navigation');
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { RallyControls } from './src/features/sunscar/RallyControls';
import { installGamepadNavigation } from './src/lib/gamepad-navigation';
window.controllerActions = [];
const input = kind => window.controllerActions.push(kind);
const root = createRoot(document.getElementById('root'));
let settings = { disabled: false, techniqueUsed: false, mounted: true };
window.showControllerControls = update => {
    settings = { ...settings, ...update };
    flushSync(() => root.render(settings.mounted ? React.createElement(RallyControls, {
        input, disabled: settings.disabled, technique: 'Heat Burst',
        techniqueUsed: settings.techniqueUsed, techniqueActive: false, stamina: 100,
        bursting: false, attack: 'Ember Shot', attackDescription: 'Race projectile',
        charge: 100, attackBlocked: false,
    }) : React.createElement('button', null, 'Race desk')));
};
window.showControllerControls({});
window.stopControllerNavigation = installGamepadNavigation();
`;
const bundle = buildSync({ stdin: { contents: fixture, resolveDir: client, loader: 'jsx' },
    bundle: true, format: 'iife', jsx: 'automatic', write: false, define: { 'process.env.NODE_ENV': '"production"' } }).outputFiles[0]?.text;
assert.ok(bundle, 'actual controls and mapper bundled');
await mkdir(out, { recursive: true });
const report = { checks: [], errors: [] };
const browser = await chromium.launch({ headless: true });
try {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.evaluate(() => {
        const pad = { id: 'Rally QA standard controller', index: 0, mapping: 'standard', connected: true,
            axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })) };
        window.controllerPad = pad;
        window.controllerPads = [pad];
        window.controllerKeys = [];
        window.controllerVisible = true;
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => window.controllerPads });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.controllerVisible ? 'visible' : 'hidden' });
        const pending = new Set(), raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => { const id = raf(now => { pending.delete(id); callback(now); }); pending.add(id); return id; };
        window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
        window.controllerPendingFrames = () => pending.size;
        for (const type of ['keydown', 'keyup']) document.addEventListener(type, event => window.controllerKeys.push([type, event.code]));
    });
    await page.addScriptTag({ content: bundle });
    const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const updatePad = async update => {
        await page.evaluate(update => {
            const pad = window.controllerPad;
            if (update.axis !== undefined) pad.axes[0] = update.axis;
            for (const [index, pressed] of Object.entries(update.buttons || {})) pad.buttons[Number(index)] = { pressed, touched: pressed, value: Number(pressed) };
        }, update);
        await frame();
    };
    const actions = () => page.evaluate(() => [...window.controllerActions]);
    const count = async kind => (await actions()).filter(action => action === kind).length;
    await frame();
    assert.equal(await page.locator('html').getAttribute('data-gamepad-connected'), 'true');
    await updatePad({ axis: -1 });
    assert.ok(await count('left') >= 1);
    await updatePad({ axis: 0 });
    assert.ok(await page.evaluate(() => window.controllerKeys.some(([type, code]) => type === 'keyup' && code === 'ArrowLeft')));
    await updatePad({ axis: 1 });
    assert.ok(await count('right') >= 1);
    await updatePad({ axis: 0, buttons: { 2: true, 3: true, 7: true, 6: true } });
    assert.equal(await count('attack'), 1); assert.equal(await count('technique'), 1);
    assert.equal(await count('jump'), 1); assert.equal(await count('burst-on'), 1);
    await frame();
    assert.equal(await count('attack'), 1, 'holding X cannot repeat the shot');
    assert.equal(await count('technique'), 1, 'holding Y cannot repeat the technique');
    await updatePad({ buttons: { 2: false, 3: false, 7: false, 6: false } });
    assert.equal((await actions()).at(-1), 'burst-off');
    report.checks.push('stick steering and X/Y/RT/LT reach actual RallyControls; edge actions and trigger release');

    await page.evaluate(() => window.showControllerControls({ techniqueUsed: true }));
    await updatePad({ buttons: { 3: true } });
    assert.equal(await count('technique'), 1, 'used technique stays unavailable');
    await updatePad({ buttons: { 3: false } });
    await page.evaluate(() => window.showControllerControls({ disabled: true }));
    assert.equal(await page.locator('.rally-controls button:disabled').count(), 6);
    const beforePause = (await actions()).filter(action => action !== 'burst-off');
    await updatePad({ axis: -1, buttons: { 2: true, 3: true, 7: true, 6: true } });
    assert.deepEqual((await actions()).filter(action => action !== 'burst-off'), beforePause, 'paused controls reject controller gameplay inputs');
    await updatePad({ axis: 0, buttons: { 2: false, 3: false, 7: false, 6: false } });
    assert.equal((await actions()).at(-1), 'burst-off', 'release remains accepted while paused');
    await page.evaluate(() => window.showControllerControls({ disabled: false, techniqueUsed: false }));
    report.checks.push('pause disables all six actual controls; releases survive pause and used technique stays blocked');

    await updatePad({ buttons: { 6: true } });
    await page.evaluate(() => {
        window.controllerPad.connected = false;
        const event = new Event('gamepaddisconnected'); Object.defineProperty(event, 'gamepad', { value: window.controllerPad }); window.dispatchEvent(event);
    });
    assert.equal((await actions()).at(-1), 'burst-off');
    assert.equal(await page.evaluate(() => window.controllerPendingFrames()), 0);
    assert.equal(await page.locator('html').getAttribute('data-gamepad-connected'), null);
    await page.evaluate(() => {
        window.controllerPad.connected = true;
        window.controllerPad.buttons[6] = { pressed: false, touched: false, value: 0 };
        const event = new Event('gamepadconnected'); Object.defineProperty(event, 'gamepad', { value: window.controllerPad }); window.dispatchEvent(event);
    });
    await frame();
    await updatePad({ buttons: { 6: true } });
    await page.evaluate(() => { window.controllerVisible = false; document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal((await actions()).at(-1), 'burst-off');
    await page.evaluate(() => {
        window.controllerPad.buttons[6] = { pressed: false, touched: false, value: 0 };
        window.controllerVisible = true; document.dispatchEvent(new Event('visibilitychange'));
    });
    await frame();
    report.checks.push('disconnect cancels polling and releases Burst; reconnect and background release remain safe');

    await page.evaluate(() => {
        const second = { ...window.controllerPad, id: 'Rally QA second controller', index: 1, axes: [0, 0],
            buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })) };
        window.controllerPads.push(second);
        const event = new Event('gamepadconnected'); Object.defineProperty(event, 'gamepad', { value: second }); window.dispatchEvent(event);
    });
    await frame();
    await updatePad({ axis: -1, buttons: { 6: true } });
    const keysAtDisconnect = await page.evaluate(() => window.controllerKeys.length);
    await page.evaluate(() => {
        window.controllerPad.connected = false;
        const event = new Event('gamepaddisconnected'); Object.defineProperty(event, 'gamepad', { value: window.controllerPad }); window.dispatchEvent(event);
    });
    await frame();
    assert.equal((await actions()).at(-1), 'burst-off', 'the held controller releases Burst while another stays connected');
    const disconnectedKeys = await page.evaluate(index => window.controllerKeys.slice(index), keysAtDisconnect);
    assert.ok(disconnectedKeys.some(([type, code]) => type === 'keyup' && code === 'ArrowLeft'));
    assert.ok(disconnectedKeys.some(([type, code]) => type === 'keyup' && code === 'ShiftLeft'));
    assert.equal(await page.locator('html').getAttribute('data-gamepad-connected'), 'true');
    assert.equal(await page.evaluate(() => window.controllerPendingFrames()), 1, 'the remaining controller keeps one polling loop');
    await page.evaluate(() => {
        const second = window.controllerPads.pop(); second.connected = false;
        const disconnected = new Event('gamepaddisconnected'); Object.defineProperty(disconnected, 'gamepad', { value: second }); window.dispatchEvent(disconnected);
        window.controllerPad.connected = true; window.controllerPad.axes[0] = 0;
        window.controllerPad.buttons[6] = { pressed: false, touched: false, value: 0 };
        const connected = new Event('gamepadconnected'); Object.defineProperty(connected, 'gamepad', { value: window.controllerPad }); window.dispatchEvent(connected);
    });
    await frame();
    report.checks.push('disconnect releases the removed controller movement/Burst while a second pad keeps polling');

    await page.evaluate(() => {
        const panel = document.createElement('div'); panel.id = 'controller-graphics';
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
        panel.style.cssText = 'position:fixed;inset:0;background:white';
        panel.innerHTML = '<button id="graphics-up" style="position:fixed;left:200px;top:140px;width:250px;height:40px">Graphics help</button>'
            + '<select id="graphics-select" aria-label="Race graphics" data-gamepad-horizontal-select="true" style="position:fixed;left:200px;top:200px;width:250px;height:40px"><option value="auto">Automatic</option><option value="3d">3D</option><option value="economy">Battery saver</option></select>'
            + '<button id="graphics-continue" style="position:fixed;left:200px;top:260px;width:250px;height:40px">Continue race</button>';
        document.body.append(panel); document.getElementById('graphics-select').focus();
    });
    await updatePad({ buttons: { 15: true } });
    assert.equal(await page.locator('#graphics-select').inputValue(), '3d');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'graphics-select');
    await updatePad({ buttons: { 15: false, 14: true } });
    assert.equal(await page.locator('#graphics-select').inputValue(), 'auto');
    await updatePad({ buttons: { 14: false, 12: true } });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'graphics-up', 'D-pad up leaves the graphics select');
    assert.equal(await page.locator('#graphics-select').inputValue(), 'auto');
    await updatePad({ buttons: { 12: false } });
    await page.locator('#graphics-select').focus();
    await updatePad({ buttons: { 13: true } });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'graphics-continue', 'D-pad down reaches Continue race');
    assert.equal(await page.locator('#graphics-select').inputValue(), 'auto');
    await updatePad({ buttons: { 13: false } });
    await page.evaluate(() => document.getElementById('controller-graphics').remove());
    report.checks.push('race graphics source and browser select use horizontal mode choice; D-pad up/down exits to other controls');

    await updatePad({ axis: -1, buttons: { 6: true } });
    const keysAtExit = await page.evaluate(() => window.controllerKeys.length);
    await page.evaluate(() => window.showControllerControls({ mounted: false }));
    await frame();
    const exitKeys = await page.evaluate(index => window.controllerKeys.slice(index), keysAtExit);
    assert.ok(exitKeys.some(([type, code]) => type === 'keyup' && code === 'ArrowLeft'));
    assert.ok(exitKeys.some(([type, code]) => type === 'keyup' && code === 'ShiftLeft'));
    const afterExit = await actions();
    await updatePad({ axis: 0, buttons: { 6: false } });
    await updatePad({ axis: 1, buttons: { 2: true, 3: true, 7: true, 6: true } });
    assert.deepEqual(await actions(), afterExit, 'exited Rally receives no controller gameplay inputs');
    await page.evaluate(() => window.stopControllerNavigation());
    assert.equal(await page.evaluate(() => window.controllerPendingFrames()), 0);
    assert.equal(await page.locator('html').getAttribute('data-gamepad-connected'), null);
    report.checks.push('mode exit releases held movement/Burst and stops Rally actions; mapper teardown leaves zero RAF');
    assert.deepEqual(report.errors, []);
    console.log(JSON.stringify({ passed: report.checks.length, checks: report.checks, errors: report.errors }, null, 2));
} catch (error) {
    report.failure = error.message;
    throw error;
} finally {
    await browser.close();
    await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2));
}
