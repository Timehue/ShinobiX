import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { storyBossEnemyTemplate, createStoryCombatBinding, validateCompletedStoryCombatSession } from '../../api/story/_authoritative-story-combat.js';
import { attachStoryTwinCombat } from '../../api/story/_twin-combat.js';
import { buildSoloPveAiEncounter } from '../../api/solo-pve/_ai-encounter.js';
import { executeSoloPveAction, type SoloPveLock } from '../../api/solo-pve/_action-service.js';
import { applyStoryBossSettlement } from '../../api/story/_settle.js';

const baseURL = process.env.TWIN_QA_URL ?? 'http://127.0.0.1:15230';
const output = resolve('shinobij.client/test-results/story-twin-trials');
await mkdir(output, { recursive: true });
const results = [];
const browser = await chromium.launch({ headless: true });
try {
    for (const village of ['Stormveil Village', 'Frostfang Village']) for (const width of [1440, 390]) for (const scenario of ['win', 'forfeit', 'loss']) {
        const character = { name: 'Trial', avatarImage: '/portraits/pve/skirmisher.webp', level: 50, village, storyProgress: 4,
            specialty: 'Ninjutsu', hp: 20000, maxHp: 20000, chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000,
            stats: { ninjutsuOffense: 2000, ninjutsuDefense: 1000, bukijutsuDefense: 1000, taijutsuDefense: 1000, speed: 1000 },
            jutsu: [], equippedJutsu: [], inventory: [], equipment: {}, pets: [], ryo: 0 };
        const now = Date.now();
        const profile = storyBossEnemyTemplate({ village, progressIndex: 4 });
        let current = buildSoloPveAiEncounter({ profile, save: { character }, playerName: 'trial', sessionId: `trial-${width}-${village.split(' ')[0]}`, now, admin: null,
            encounter: { kind: 'story-boss', id: `${village}:4`, sourceId: profile.id, bindingId: `trial-${width}-${village.split(' ')[0]}` } });
        attachStoryTwinCombat(current);
        const binding = createStoryCombatBinding({ runId: current.sessionId, playerName: 'trial', village, progressIndex: 4, now });
        const battle = current.huntCombat!.battle;
        const enemies = battle.actors.filter(a => a.side === 'enemy');
        const finisher = { id: 'qa-trial-finisher', name: 'Trial Finisher', type: 'Ninjutsu', element: 'None', ap: 60, range: 30,
            effectPower: 10000, chakraCost: 0, staminaCost: 0, cooldown: 0, method: 'SINGLE', target: 'OPPONENT', tags: [] };
        battle.actors[0].character.jutsu = [finisher];
        if (scenario === 'loss') {
            battle.actors[0].hp = 1;
            battle.actors[0].pos = 0; battle.actors[1].pos = 1; battle.actors[2].pos = 12;
        }
        let rewardCalls = 0;
        let rewardAttempts = 0;
        let allowOutcome = scenario === 'win';
        const commands: unknown[] = [];
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        const towerCalls: string[] = [];
        await page.exposeFunction('__TWIN_TRIAL_API__', async ({ url, body }: { url: string; body: Record<string, unknown> }) => {
            if (url.includes('/towers/')) {
                towerCalls.push(url);
                throw new Error(`Wrong authority route: ${url}`);
            }
            if (url.includes('/story/boss-start')) return { ok: true, runId: current.sessionId, session: current };
            if (url.includes('/solo-pve/state')) return { ok: true, session: current };
            if (url.includes('/solo-pve/action')) {
                commands.push(body.action);
                const result = await executeSoloPveAction({ sessionId: current.sessionId, ownerSlug: 'trial', expectedVersion: Number(body.expectedVersion),
                    moveToken: String(body.moveToken), action: { type: String(body.type), action: body.action } as never }, {
                    read: async () => structuredClone(current), write: async s => { current = structuredClone(s); },
                    lock: (async (_key, fn) => fn()) as SoloPveLock, now: () => Date.now(),
                });
                return result.body;
            }
            if (url.includes('/story/settle')) {
                if (++rewardAttempts === 1) return { ok: false, error: 'QA temporary reward outage' };
                const validation = validateCompletedStoryCombatSession({ binding, session: current, character, playerName: 'trial' });
                if (!validation.ok) throw new Error(`Unverified reward: ${validation.reason}`);
                const reward = applyStoryBossSettlement(character, { opponentId: binding.opponentId }, current.player.hp);
                if (!reward.ok) throw new Error(reward.error);
                rewardCalls++;
                return { ...reward, _saveVersion: 1, replayed: rewardCalls > 1 };
            }
            if (url.includes('/pve/fight-outcome')) return allowOutcome ? { ok: true, character, _saveVersion: 1 } : { ok: false, error: 'QA temporary outcome outage' };
            return { ok: true, messages: [], spectators: [], locked: false };
        });
        const trialName = village.startsWith('Stormveil') ? 'Tempest Twins' : 'Glacier Twins';
        await page.addInitScript(config => { (window as unknown as { __TWIN_TRIAL_QA__: unknown }).__TWIN_TRIAL_QA__ = config; },
            { character, theme: { bossName: trialName, chapterLabel: `${trialName} · Jonin Trial`, village } });
        await page.goto(`${baseURL}/combat-grid-qa.html?twin-trial`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Start twin trial', exact: true }).click();
        const actor = (id: string) => page.locator(`[data-battlefield-actor-id="${id}"]`);
        for (const enemy of enemies) {
            await expect(actor(enemy.id)).toBeVisible();
            const sprite = actor(enemy.id).locator('img.battlefield-actor-sprite');
            await expect(sprite).toHaveAttribute('src', String(enemy.character.avatarImage));
            await expect.poll(() => sprite.evaluate(image => (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
        }
        await expect(page.getByRole('list', { name: 'Remaining turn order' })).toContainText(enemies[0].name);
        await expect(page.getByRole('list', { name: 'Remaining turn order' })).toContainText(enemies[1].name);
        const leaveMetrics = await page.getByRole('button', { name: 'Forfeit trial', exact: true }).evaluate(button => {
            const label = document.createRange(); label.selectNodeContents(button);
            const style = getComputedStyle(button);
            return { text: button.textContent, width: button.clientWidth, padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), label: label.getBoundingClientRect().width };
        });
        expect(leaveMetrics.label <= leaveMetrics.width - leaveMetrics.padding, `${village} ${width}: ${JSON.stringify(leaveMetrics)}`).toBe(true);
        const scene = `/scenes/story/${profile.id.replace('story-ai-', 'story-')}-twins.webp`;
        await expect(page.locator('.screen-battleTowerFight').first()).toHaveCSS('background-image', new RegExp('twins.webp'));
        expect(await page.evaluate(async src => { const img = new Image(); img.src = src; await img.decode(); return img.naturalWidth; }, scene)).toBe(1536);
        if (scenario === 'win') for (const enemy of enemies) {
            await page.locator(`#tower-roster-actor-${enemy.id}`).click();
            const details = page.locator('#tower-fighter-details');
            await expect(details).toBeVisible();
            await expect(details.locator('img.tower-fighter-portrait')).toHaveAttribute('src', String(enemy.character.avatarImage));
            await details.getByText('Combat details', { exact: true }).click();
            for (const move of enemy.character.jutsu as Array<{ name: string }>) await expect(details.locator('[aria-label="Fighter techniques"]')).toContainText(move.name);
            await details.getByRole('button', { name: 'Close fighter details' }).click();
        }
        await page.locator('.tower-fight-header').scrollIntoViewIfNeeded();
        if (scenario !== 'win') {
            if (scenario === 'forfeit') {
                await page.getByRole('button', { name: 'Forfeit trial', exact: true }).click();
                await page.getByRole('button', { name: 'Confirm', exact: true }).click();
            } else await page.getByRole('button', { name: /^End turn/ }).click();
            await expect(page.getByRole('dialog', { name: 'Story battle lost' })).toBeVisible({ timeout: 15000 });
            await expect(page.getByRole('button', { name: 'Retry saving result', exact: true })).toBeVisible({ timeout: 15000 });
            await expect(page.getByRole('button', { name: 'Return to story', exact: true })).toHaveCount(0);
            expect(current.winner).toBe('enemy');
            expect(rewardCalls).toBe(0);
            await page.screenshot({ path: resolve(output, `${village.split(' ')[0]}-${width}-${scenario}-retry.png`), fullPage: true });
            allowOutcome = true;
            await page.getByRole('button', { name: 'Retry saving result', exact: true }).click();
            await page.getByRole('button', { name: 'Return to story', exact: true }).click();
            await expect(page.locator('.screen-battleTowerFight')).toHaveCount(0);
            expect(towerCalls).toEqual([]);
            results.push({ village, width, scenario, rewardCalls, closed: true, towerCalls });
            await context.close();
            continue;
        }
        await page.screenshot({ path: resolve(output, `${village.split(' ')[0]}-${width}-both.png`), fullPage: true });
        const cast = async (id: string) => {
            await page.locator('button.combat-jutsu-button').filter({ hasText: 'Trial Finisher' }).click();
            // The actor's wrapper owns the target click; its art is pointer-inert.
            await actor(id).locator('..').click();
        };
        await cast(enemies[0].id);
        await expect.poll(() => current.huntCombat!.battle.actors.find(a => a.id === enemies[0].id)!.hp).toBe(0);
        expect(current.status).toBe('active');
        expect(rewardCalls).toBe(0);
        expect(current.huntCombat!.battle.actors.find(a => a.id === enemies[1].id)!.hp).toBeGreaterThan(0);
        await expect(page.getByTestId('twin-qa-reward')).toHaveText('No reward');
        await page.screenshot({ path: resolve(output, `${village.split(' ')[0]}-${width}-one-left.png`), fullPage: true });
        await page.getByRole('button', { name: /^End turn/ }).click();
        await expect.poll(() => current.round).toBeGreaterThan(1);
        await cast(enemies[1].id);
        await expect(page.getByRole('button', { name: 'Retry reward', exact: true })).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: 'Retry reward', exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Chapter complete' })).toBeVisible({ timeout: 15000 });
        expect(current.winner).toBe('player');
        expect(rewardCalls).toBe(1);
        await expect(page.getByTestId('twin-qa-reward')).toHaveText('Chapter 5 saved');
        await page.screenshot({ path: resolve(output, `${village.split(' ')[0]}-${width}-victory.png`), fullPage: true });
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(page.locator('.screen-battleTowerFight')).toHaveCount(0);
        expect(towerCalls).toEqual([]);
        results.push({ village, width, scenario, rewardCalls, rewardAttempts, closed: true, towerCalls, actors: enemies.map(a => ({ id: a.id, name: a.name, hp: a.maxHp })), commands });
        await context.close();
    }
    await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`Verified ${results.length} complete desktop/mobile twin trials through the story host.`);
} finally { await browser.close(); }
