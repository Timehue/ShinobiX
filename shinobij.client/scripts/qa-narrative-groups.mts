import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { groupCombatCases, groupCombatFixture, groupFinisher } from '../../scripts/narrative-group-fixtures.js';
import { executeSoloPveAction, type SoloPveLock } from '../../api/solo-pve/_action-service.js';
import { narrativeGroupWinConfirmed } from '../../api/solo-pve/_group-proof.js';
import { createStoryCombatBinding, validateCompletedStoryCombatSession } from '../../api/story/_authoritative-story-combat.js';
import { applyStoryBossSettlement } from '../../api/story/_settle.js';

const baseURL = process.env.GROUP_QA_URL ?? 'http://127.0.0.1:15250';
const output = resolve('shinobij.client/test-results/narrative-groups');
await mkdir(output, { recursive: true });
const results = [];
const forfeit = process.env.GROUP_QA_MODE === 'forfeit';
const loss = process.env.GROUP_QA_MODE === 'loss';
const browser = await chromium.launch({ headless: true });
try {
    for (const entry of groupCombatCases.filter(entry => !(forfeit || loss) || entry.key.startsWith('story-ai-') || entry.key.includes('qb-debt'))) for (const width of [1440, 390]) {
        const { session, character, village, progress } = groupCombatFixture(entry.key, entry.name, Date.now());
        let current = session;
        const story = entry.key.startsWith('story-ai-');
        const binding = createStoryCombatBinding({ runId: current.sessionId, playerName: 'groupaudit', village, progressIndex: progress, now: current.createdAt });
        const enemies = structuredClone(current.huntCombat!.battle.actors.filter(a => a.side === 'enemy'));
        current.huntCombat!.battle.actors[0].character.jutsu = [groupFinisher];
        if (loss) {
            current.huntCombat!.battle.actors[0].hp = 1;
            current.huntCombat!.battle.actors[0].pos = 0;
            current.huntCombat!.battle.actors[1].pos = 1;
            current.player.hp = 1;
        }
        let rewardCalls = 0, rewardAttempts = 0, outcomeAttempts = 0;
        let allowOutcome = !(forfeit || loss);
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const errors: string[] = [];
        const towerCalls: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.exposeFunction('__TWIN_TRIAL_API__', async ({ url, body }: { url: string; body: Record<string, unknown> }) => {
            if (url.includes('/towers/')) {
                towerCalls.push(url);
                throw new Error(`Wrong authority route: ${url}`);
            }
            if (url.includes('/story/boss-start')) return { ok: true, runId: current.sessionId, session: current };
            if (url.includes('/missions/ai-fight-start')) {
                if (body.resumeWorldFight || body.resumeAiFight) return { __status: 204 };
                return { ok: true, token: 'qa-group-token', sessionId: current.sessionId, session: current, opponentId: entry.key, opponentName: entry.name, battleKind: 'defense' };
            }
            if (url.includes('/solo-pve/state')) return { ok: true, session: current };
            if (url.includes('/solo-pve/action')) {
                // Controlled last hits isolate UI/result transitions from balance.
                // Full sealed starting HP was asserted before the first command.
                const intent = body.action as { type?: string; targetId?: string } | undefined;
                if (intent?.type === 'jutsu') current.huntCombat!.battle.actors.find(a => a.id === intent.targetId)!.hp = 1;
                if (intent?.type === 'wait' && !loss) current.huntCombat!.battle.actors[0].hp = current.huntCombat!.battle.actors[0].maxHp;
                return (await executeSoloPveAction({ sessionId: current.sessionId, ownerSlug: current.ownerSlug, expectedVersion: Number(body.expectedVersion), moveToken: String(body.moveToken), action: { type: String(body.type), action: body.action } as never }, {
                    read: async () => structuredClone(current), write: async s => { current = structuredClone(s); }, lock: (async (_key, fn) => fn()) as SoloPveLock, now: () => Date.now(),
                })).body;
            }
            if (url.includes('/story/settle') || url.includes('/missions/report-ai-fight')) {
                if (++rewardAttempts === 1) return { ok: false, error: 'QA temporary reward outage' };
                if (forfeit || loss) return { ok: true, outcome: 'loss', character: { ...character, hp: current.player.hp }, ryo: 0, statPoints: 0, xp: 0, _saveVersion: 1 };
                if (!narrativeGroupWinConfirmed(current)) throw new Error('Premature group reward');
                rewardCalls++;
                if (story) {
                    const validation = validateCompletedStoryCombatSession({ binding, session: current, character, playerName: 'groupaudit' });
                    if (!validation.ok) throw new Error(validation.reason);
                    return { ...applyStoryBossSettlement(character, { opponentId: binding.opponentId }, current.player.hp), _saveVersion: 1 };
                }
                return { ok: true, outcome: 'win', character, ryo: 25, statPoints: 1, xp: 0, _saveVersion: 1 };
            }
            if (url.includes('/pve/fight-outcome')) {
                outcomeAttempts++;
                return allowOutcome ? { ok: true, character: { ...character, hp: current.player.hp }, _saveVersion: 1 } : { ok: false, error: 'QA temporary outcome outage' };
            }
            return { ok: true, messages: [], spectators: [], locked: false };
        });
        await page.addInitScript(config => {
            (window as unknown as { __TWIN_TRIAL_QA__: unknown }).__TWIN_TRIAL_QA__ = config.story;
            (window as unknown as { __GROUP_QA__: unknown }).__GROUP_QA__ = config.group;
        }, { story: { character, theme: { bossName: entry.name, chapterLabel: entry.name, village } }, group: { character, request: { opponentId: entry.key, opponentLevel: 50, opponentName: entry.name, battleKind: 'defense', returnScreen: 'world' } } });
        await page.goto(`${baseURL}/combat-grid-qa.html?${story ? 'twin-trial' : 'narrative-group'}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: story ? 'Start twin trial' : 'Start group encounter', exact: true }).click();
        const actor = (id: string) => page.locator(`[data-battlefield-actor-id="${id}"]`);
        for (const enemy of enemies) {
            await expect(actor(enemy.id)).toBeVisible();
            await expect(actor(enemy.id).locator('..')).toHaveAttribute('title', `${enemy.name} ${enemy.hp}/${enemy.maxHp}`);
            const sprite = actor(enemy.id).locator('img.battlefield-actor-sprite');
            await expect.poll(() => sprite.evaluate(image => (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
        }
        await expect(page.getByRole('button', { name: 'Forfeit encounter', exact: true })).toBeVisible();
        const stem = `${entry.key.replaceAll(':', '-')}-${width}${forfeit ? '-forfeit' : loss ? '-loss' : ''}`;
        await page.screenshot({ path: resolve(output, `${stem}-start.png`), fullPage: true });
        if (forfeit || loss) {
            const hp = current.player.hp;
            if (forfeit) {
                await page.getByRole('button', { name: 'Forfeit encounter', exact: true }).click();
                await page.getByRole('button', { name: 'Confirm', exact: true }).click();
            } else await page.getByRole('button', { name: /^End turn/ }).click();
            await expect(page.getByRole('dialog', { name: story ? 'Story battle lost' : 'Fight lost' })).toBeVisible({ timeout: 15000 });
            const retry = page.getByRole('button', { name: story ? 'Retry saving result' : 'Retry', exact: true });
            await expect(retry).toBeVisible({ timeout: 15000 }); allowOutcome = true; await retry.click();
            const leave = page.getByRole('button', { name: story ? 'Return to story' : 'Return', exact: true });
            await expect(leave).toBeEnabled(); await leave.click();
            await expect(page.locator('.screen-battleTowerFight')).toHaveCount(0);
            expect(current.winner).toBe('enemy'); expect(rewardCalls).toBe(0);
            expect(current.player.hp).toBe(loss ? 0 : hp - Math.floor(current.player.maxHp * .1));
            expect(errors).toEqual([]);
            expect(towerCalls).toEqual([]);
            results.push({ key: entry.key, width, scenario: loss ? 'loss' : 'forfeit', closed: true, rewardCalls, rewardAttempts, outcomeAttempts, towerCalls });
            console.log(`PASS ${entry.key} ${width}: ${loss ? 'knockout' : 'forfeit'}, result retry, clean exit`);
            await context.close(); continue;
        }
        for (const [i, enemy] of enemies.entries()) {
            if (i) await page.getByRole('button', { name: /^End turn/ }).click();
            await page.locator('button.combat-jutsu-button').filter({ hasText: 'Audit finisher' }).click();
            await actor(enemy.id).locator('..').click();
            await expect.poll(() => current.huntCombat!.battle.actors.find(a => a.id === enemy.id)!.hp).toBe(0);
            if (i < enemies.length - 1) { expect(current.status).toBe('active'); expect(rewardCalls).toBe(0); }
        }
        const retry = page.getByRole('button', { name: story ? 'Retry reward' : 'Retry', exact: true });
        await expect(retry).toBeVisible({ timeout: 20000 });
        await retry.click();
        await expect(page.getByRole('dialog', { name: story ? 'Chapter complete' : 'Fight won' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({ timeout: 15000 });
        await expect.poll(() => rewardCalls).toBe(1); expect(current.winner).toBe('player');
        await page.screenshot({ path: resolve(output, `${stem}-result.png`), fullPage: true });
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(page.locator('.screen-battleTowerFight')).toHaveCount(0);
        if (!story) await expect(page.getByTestId('group-qa-result')).toHaveText('Closed');
        expect(errors).toEqual([]);
        expect(towerCalls).toEqual([]);
        results.push({ key: entry.key, width, count: enemies.length, hp: enemies.map(a => a.maxHp), rewardCalls, rewardAttempts, closed: true, towerCalls });
        console.log(`PASS ${entry.key} ${width}: ${enemies.length} actors, reward retry, clean exit`);
        await context.close();
    }
    await writeFile(resolve(output, forfeit ? 'forfeit-results.json' : loss ? 'loss-results.json' : 'results.json'), JSON.stringify(results, null, 2));
    console.log(`Verified ${results.length} complete desktop/mobile group encounters.`);
} finally { await browser.close(); }
