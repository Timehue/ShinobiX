import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { groupCombatCases, groupCombatFixture, groupFinisher } from '../../scripts/narrative-group-fixtures.js';
import { executeSoloPveAction, type SoloPveLock } from '../../api/solo-pve/_action-service.js';
import { narrativeGroupWinConfirmed } from '../../api/solo-pve/_group-proof.js';
import { createStoryCombatBinding, validateCompletedStoryCombatSession } from '../../api/story/_authoritative-story-combat.js';
import { applyStoryBossSettlement } from '../../api/story/_settle.js';

const baseURL = process.env.GROUP_QA_URL ?? 'http://127.0.0.1:15250';
const output = resolve('shinobij.client/test-results/fight-transitions');
await mkdir(output, { recursive: true });
const results = [];
const keys = ['story-ai-stormveil-village-65', 'story-ai-frostfang-village-35',
    'world-questbook-qb-debt-house-kuroban', 'world-patrol-moonshadow'];
const browser = await chromium.launch({ headless: true });
try {
    for (const key of keys) for (const width of [1440, 390]) {
        const name = groupCombatCases.find(entry => entry.key === key)!.name;
        const { session, character, village, progress } = groupCombatFixture(key, name, Date.now());
        let current = session;
        const story = key.startsWith('story-ai-');
        const title = current.huntCombat!.battle.encounterFloor!.name;
        const enemies = structuredClone(current.huntCombat!.battle.actors.filter(a => a.side === 'enemy'));
        current.huntCombat!.battle.actors[0].character.jutsu = [groupFinisher];
        const binding = createStoryCombatBinding({ runId: current.sessionId, playerName: 'groupaudit', village, progressIndex: progress, now: current.createdAt });
        let startCalls = 0, rewardAttempts = 0, rewardCalls = 0;
        let releaseStart!: () => void, releaseReward!: () => void;
        const startGate = new Promise<void>(resolve => { releaseStart = resolve; });
        const rewardGate = new Promise<void>(resolve => { releaseReward = resolve; });
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors: string[] = [], towerCalls: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.exposeFunction('__TWIN_TRIAL_API__', async ({ url, body }: { url: string; body: Record<string, unknown> }) => {
            if (url.includes('/towers/')) { towerCalls.push(url); throw new Error(`Wrong authority route: ${url}`); }
            if (url.includes('/story/boss-start') || url.includes('/missions/ai-fight-start')) {
                if (body.resumeWorldFight || body.resumeAiFight) return { __status: 204 };
                if (++startCalls === 1) return { ok: false, error: 'Temporary launch failure. Please try again.' };
                await startGate;
                return story ? { ok: true, runId: current.sessionId, session: current }
                    : { ok: true, token: 'qa-transition-token', sessionId: current.sessionId, session: current,
                        opponentId: key, opponentName: title, battleKind: 'defense' };
            }
            if (url.includes('/solo-pve/state')) return { ok: true, session: current };
            if (url.includes('/solo-pve/action')) {
                // Full-health starting actors are checked below. Last hits then
                // isolate transition behavior from the separate balance matrix.
                const intent = body.action as { type?: string; targetId?: string } | undefined;
                if (intent?.type === 'jutsu') current.huntCombat!.battle.actors.find(a => a.id === intent.targetId)!.hp = 1;
                if (intent?.type === 'wait') current.huntCombat!.battle.actors[0].hp = current.huntCombat!.battle.actors[0].maxHp;
                return (await executeSoloPveAction({ sessionId: current.sessionId, ownerSlug: current.ownerSlug,
                    expectedVersion: Number(body.expectedVersion), moveToken: String(body.moveToken),
                    action: { type: String(body.type), action: body.action } as never }, {
                    read: async () => structuredClone(current), write: async next => { current = structuredClone(next); },
                    lock: (async (_key, fn) => fn()) as SoloPveLock, now: () => Date.now(),
                })).body;
            }
            if (url.includes('/story/settle') || url.includes('/missions/report-ai-fight')) {
                if (!narrativeGroupWinConfirmed(current)) throw new Error('Premature group reward');
                if (++rewardAttempts === 1) return { ok: false, error: 'Temporary reward failure. Please retry.' };
                await rewardGate;
                rewardCalls++;
                if (story) {
                    const validation = validateCompletedStoryCombatSession({ binding, session: current, character, playerName: 'groupaudit' });
                    if (!validation.ok) throw new Error(validation.reason);
                    return { ...applyStoryBossSettlement(character, { opponentId: binding.opponentId }, current.player.hp), _saveVersion: 1 };
                }
                return { ok: true, outcome: 'win', character: { ...character, hp: current.player.hp }, ryo: 25, statPoints: 1, xp: 0, _saveVersion: 1 };
            }
            if (url.includes('/pve/fight-outcome')) return { ok: true, character: { ...character, hp: current.player.hp }, _saveVersion: 1 };
            return { ok: true, messages: [], spectators: [], locked: false };
        });
        await page.addInitScript(config => {
            (window as unknown as { __TWIN_TRIAL_QA__: unknown }).__TWIN_TRIAL_QA__ = config.story;
            (window as unknown as { __GROUP_QA__: unknown }).__GROUP_QA__ = config.group;
        }, { story: { character, theme: { bossName: title, chapterLabel: title, village } },
            group: { character, request: { opponentId: key, opponentLevel: 65, opponentName: title, battleKind: 'defense', returnScreen: 'world' } } });
        await page.goto(`${baseURL}/combat-grid-qa.html?${story ? 'twin-trial' : 'narrative-group'}`, { waitUntil: 'domcontentloaded' });
        const launch = page.getByRole('button', { name: story ? 'Start twin trial' : 'Start group encounter', exact: true });
        await launch.click();
        await expect.poll(() => startCalls).toBe(1);
        if (story) {
            const notice = page.getByRole('alertdialog', { name: 'Notice', exact: true });
            await expect(notice).toBeVisible();
            await expect(notice).toContainText('Temporary launch failure. Please try again.');
            await notice.getByRole('button', { name: 'OK', exact: true }).click();
            await launch.click();
        } else {
            await expect(page.getByRole('heading', { name: 'Fight unavailable', exact: true })).toBeVisible();
            await page.getByRole('button', { name: 'Retry', exact: true }).click();
        }
        await expect.poll(() => startCalls).toBe(2);
        await launch.click();
        expect(startCalls).toBe(2);
        await expect(page.locator('.screen-battleTowerFight')).toHaveCount(0);
        expect(rewardAttempts).toBe(0);
        releaseStart();
        const actor = (id: string) => page.locator(`[data-battlefield-actor-id="${id}"]`);
        for (const enemy of enemies) {
            await expect(actor(enemy.id)).toBeVisible();
            await expect(actor(enemy.id).locator('..')).toHaveAttribute('title', `${enemy.name} ${enemy.hp}/${enemy.maxHp}`);
        }
        await expect(page.locator('.tower-fight-header')).not.toContainText(/Floor \d|Battle Towers|Endless Spire/);
        const stem = `${key}-${width}`;
        await page.screenshot({ path: resolve(output, `${stem}-entry.png`), fullPage: true });
        for (const [index, enemy] of enemies.entries()) {
            if (index) await page.getByRole('button', { name: /^End turn/ }).click();
            await page.locator('button.combat-jutsu-button').filter({ hasText: 'Audit finisher' }).click();
            await actor(enemy.id).locator('..').click();
            await expect.poll(() => current.huntCombat!.battle.actors.find(a => a.id === enemy.id)!.hp).toBe(0);
            if (index < enemies.length - 1) { expect(current.status).toBe('active'); expect(rewardAttempts).toBe(0); }
        }
        const retry = page.getByRole('button', { name: story ? 'Retry reward' : 'Retry', exact: true });
        await expect(retry).toBeVisible({ timeout: 20000 });
        await retry.click();
        await expect.poll(() => rewardAttempts).toBe(2);
        expect(rewardCalls).toBe(0);
        const finish = page.getByRole('button', { name: 'Continue', exact: true });
        expect(await finish.isVisible() && await finish.isEnabled()).toBe(false);
        await page.screenshot({ path: resolve(output, `${stem}-saving.png`), fullPage: true });
        releaseReward();
        await expect(page.getByRole('dialog', { name: story ? 'Chapter complete' : 'Fight won', exact: true })).toBeVisible();
        await expect(finish).toBeEnabled({ timeout: 15000 });
        expect(rewardCalls).toBe(1);
        await finish.click();
        await expect(page.locator('.screen-battleTowerFight')).toHaveCount(0);
        await expect(launch).toBeEnabled();
        if (!story) await expect(page.getByTestId('group-qa-result')).toHaveText('Closed');
        expect(towerCalls).toEqual([]); expect(errors).toEqual([]);
        results.push({ key, width, startCalls, rewardAttempts, rewardCalls, closed: true, towerCalls });
        console.log(`PASS ${key} ${width}: failed launch, delayed retry, single start, presentation, delayed reward and clean return`);
        await context.close();
    }
    await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
} finally { await browser.close(); }
