import { expect, test } from '@playwright/test';
import { buildTowerEncounter } from '../../api/towers/_encounter';
import { startRound } from '../../api/towers/_engine';
import { FLOOR_CATALOG, CLAN_BOSS_FLOORS } from '../../api/towers/_floor-catalog';
import { getSpireFloor } from '../../api/towers/_spire-catalog';
import { publicTowerFloorMeta } from '../../api/towers/floors';
import { configureClanBossEncounter } from '../../api/clan-boss/_encounter-config';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium', 'Canonical desktop and phone coverage.');
    test.skip(!['chromium-desktop', 'chromium-mobile'].includes(info.project.name), 'Lifecycle checks at desktop and phone widths.');
});

for (const mode of ['tower', 'spire', 'clan'] as const) for (const winner of ['squad', 'enemy'] as const) {
    test(`${mode} ${winner} result saves, reloads and returns to its own destination`, async ({ page }, info) => {
        test.setTimeout(120000);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const save = uiAuditSave();
        save.character = { ...save.character, ...(mode === 'clan' ? { clan: 'Shadow Cell', clanFounder: true } : {}) };
        const runtime = await installUiAuditRuntime(page, save);
        const floor = mode === 'clan' ? CLAN_BOSS_FLOORS[0] : mode === 'spire' ? getSpireFloor(1)! : FLOOR_CATALOG[0];
        const runId = mode === 'clan' ? 'cboss-behavior01' : `tower-behavior-${mode}`;
        let session = buildTowerEncounter({ floor, runId, seed: 42, partySize: 1, now: Date.now(), embedFloor: mode !== 'clan',
            squad: [{ id: 'sq-0', name: 'AuditNinja', ownerSlug: 'auditninja', ai: false, character: save.character! }] });
        if (mode === 'clan') configureClanBossEncounter(session, floor, 100000);
        startRound(session);
        // Begin at the human's turn. The builder alone is a pre-round snapshot;
        // real start handlers initialize the queue before publishing a session.
        session.activeIndex = session.turnQueue.indexOf('sq-0');
        session.activeAp = 100;
        if (mode === 'spire') session = { ...session, ascensionTier: 1 };
        let started = mode === 'spire' || (mode === 'clan' && winner === 'squad');
        let allowSettle = false, paid = false, settleAttempts = 0;
        const clanPoolRemaining = winner === 'squad' ? 500000 : 550000;
        const endpoint = mode === 'clan' ? '/api/clan-boss/assault-settle' : '/api/towers/settle';
        await page.route('**/api/towers/**', route => {
            const path = new URL(route.request().url()).pathname;
            if (path.endsWith('/floors')) return route.fulfill({ json: { floors: [publicTowerFloorMeta(floor)] } });
            if (path.endsWith('/my-run')) return route.fulfill({ json: started && !paid ? { runId, session } : {} });
            if (path.endsWith('/start')) { started = true; return route.fulfill({ json: { runId, session } }); }
            if (path.endsWith('/party')) return route.fulfill({ json: { ok: true, party: null, invitations: [], publicParties: [] } });
            if (path.endsWith('/action')) {
                // Controlled terminal projection: authoritative engine and settlement
                // invariants run separately. This isolates host lifecycle behavior.
                session = { ...session, status: 'done', winner, actionVersion: session.actionVersion + 1,
                    objectiveState: { ...session.objectiveState, completed: winner === 'squad', failed: winner === 'enemy' },
                    actors: session.actors.map(actor => actor.side === (winner === 'squad' ? 'enemy' : 'squad') ? { ...actor, hp: 0 }
                        : mode === 'clan' && winner === 'enemy' && actor.id === session.phaseState.bossId ? { ...actor, hp: actor.maxHp / 2 } : actor) };
            }
            return route.fulfill({ json: { applied: true, session, actionVersion: session.actionVersion } });
        });
        await page.route(`**${endpoint}`, route => {
            settleAttempts++;
            if (!allowSettle) return route.fulfill({ status: 503, json: { error: 'Temporary result outage.' } });
            paid = true;
            if (mode === 'clan') return route.fulfill({ json: { ok: true, pool: clanPoolRemaining, poolMax: 600000,
                killed: false, justKilled: false, result: { damage: 600000 - clanPoolRemaining, wiped: winner === 'enemy', clean: winner === 'squad', rounds: 1 } } });
            return route.fulfill({ json: { ok: true, settled: true, results: winner === 'squad' ? {
                auditninja: { paid: true, ryo: 100, statPoints: 1, fateShards: 0, boneCharms: 0, firstClear: true, score: 1000 },
            } : {}, character: runtime.serverSave().character, _saveVersion: runtime.currentVersion() } });
        });
        if (mode === 'clan') {
            await page.route('**/api/save/clan-shadowcell', route => route.fulfill({ json: { name: 'Shadow Cell', village: 'Stormveil Village',
                founderName: 'AuditNinja', createdAt: Date.now(), level: 8, xp: 0, treasury: { ryo: 0, warSupply: 0, items: [] },
                members: [{ name: 'AuditNinja', level: 85, village: 'Stormveil Village', specialty: 'Ninjutsu', isFounder: true }],
                roleOverrides: {}, joinRequests: [], notices: [], warHistory: [] } }));
            await page.route('**/api/clan-boss/get?**', route => route.fulfill({ json: { ok: true, active: true, inClan: true,
                endsAt: Date.now() + 86400000, boss: { id: 'oni-warlord', name: 'The Oni Warlord', mechanic: 'enrage', sectorId: 66 },
                myClan: { clanName: 'Shadow Cell', pool: paid ? clanPoolRemaining : 600000, poolMax: 600000, killed: false,
                    damageDealt: paid ? 600000 - clanPoolRemaining : 0, participants: 1, attemptsPerMember: 5, myAttemptsLeft: 4, score: 100, rank: 1 }, standings: [] } }));
            await page.route('**/api/clan-boss/party?**', route => route.fulfill({ status: 404, json: { error: 'Parties disabled.' } }));
            await page.route('**/api/clan-boss/assault-start', route => {
                started = true;
                return route.fulfill({ json: { runId, session } });
            });
            await page.goto('/#/clan', { waitUntil: 'domcontentloaded' });
            await page.getByRole('button', { name: 'Boss', exact: true }).click();
            if (started) await page.getByRole('button', { name: 'Rejoin your accepted operation', exact: true }).click();
            else await page.getByRole('button', { name: /^Start solo assault/ }).click();
        } else {
            // This combat-capable route is refresh-restorable, deliberately not
            // a shareable hash deep link. Restore its lobby the supported way.
            await page.addInitScript(() => localStorage.setItem('lastScreen.v1', 'battleTowers'));
            if (mode === 'spire') await page.addInitScript(id => localStorage.setItem('shinobix:towerRunId', id), runId);
            await page.goto('/', { waitUntil: 'domcontentloaded' });
            if (mode === 'tower') await page.getByRole('button', { name: /Enter Floor 1 solo/ }).click();
        }
        const combat = page.locator('.screen-battleTowerFight');
        await expect(combat).toBeVisible();
        const intro = page.getByRole('button', { name: 'Enter battle', exact: true });
        if (await intro.isVisible()) await intro.click();
        for (const enemy of session.actors.filter(actor => actor.side === 'enemy')) {
            expect(enemy.hp).toBe(enemy.maxHp);
            await expect(combat.locator(`[id="tower-board-actor-${enemy.id}"]`)).toHaveAttribute('title', `${enemy.name} ${enemy.hp}/${enemy.maxHp}`);
        }
        if (mode === 'clan') {
            await expect(combat.locator('.tower-fight-title')).toContainText('Oni');
            await combat.getByRole('button', { name: 'Leave view', exact: true }).click();
            const confirm = page.getByRole('alertdialog');
            await expect(confirm).toContainText('Clan Hall → Boss');
            await expect(confirm).not.toContainText('Battle Towers');
            await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
            await expect(combat).toHaveCount(0);
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'clan');
            await page.getByRole('button', { name: 'Rejoin your accepted operation', exact: true }).click();
            await expect(combat).toBeVisible();
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        if (mode === 'clan') {
            await page.getByRole('button', { name: 'Boss', exact: true }).click();
            await page.getByRole('button', { name: 'Rejoin your accepted operation', exact: true }).click();
        }
        await expect(combat).toBeVisible();
        if (await intro.isVisible()) await intro.click();
        await page.getByRole('button', { name: /^End turn/ }).click();
        const result = page.locator('.tower-completion-card[role="dialog"]');
        await expect(result).toContainText('Your result is not saved yet');
        if (mode === 'spire') await expect(result).not.toContainText('now open');
        expect(paid).toBe(false);
        const returnLabel = mode === 'clan' ? 'Return to Clan Boss' : mode === 'spire' ? 'Leave the Spire' : 'Leave the Tower';
        await expect(result.getByRole('button', { name: returnLabel, exact: true })).toBeDisabled();
        await page.reload({ waitUntil: 'domcontentloaded' });
        if (mode === 'clan') {
            await page.getByRole('button', { name: 'Boss', exact: true }).click();
            await page.getByRole('button', { name: 'Finish assault results', exact: true }).click();
        }
        await expect(result).toBeVisible();
        allowSettle = true;
        await result.getByRole('button', { name: 'Try again', exact: true }).click();
        await expect(result.getByRole('button', { name: returnLabel, exact: true })).toBeEnabled();
        if (mode === 'clan') {
            await expect(result).toContainText(clanPoolRemaining.toLocaleString());
            await expect(result).not.toContainText('Saving your rewards');
            await expect(result).not.toContainText('Floor 9001');
            const art = result.locator('.tower-completion-art');
            await expect(art).toHaveAttribute('src', /clan-boss-oni.*\.webp/);
            await expect.poll(() => art.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
        }
        await page.screenshot({ path: info.outputPath(`${mode}-${winner}-result.png`), fullPage: true });
        if (mode !== 'clan' && winner === 'squad') {
            await result.getByRole('button', { name: 'Plan next floor', exact: true }).click();
            await expect(combat).toHaveCount(0);
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'battleTowers');
            await page.locator('.tower-lobby-back').click();
        } else await result.getByRole('button', { name: returnLabel, exact: true }).click();
        await expect(combat).toHaveCount(0);
        if (mode === 'clan') {
            await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'clan');
            await expect(page.getByRole('heading', { name: 'The Oni Warlord', exact: true })).toBeVisible();
        } else {
            expect(await page.evaluate(() => localStorage.getItem('shinobix:towerRunId'))).toBeNull();
            expect(await page.evaluate(() => localStorage.getItem('shinobix:towerRecoveryRunId:v1'))).toBeNull();
            await expect(page.locator('.app-shell')).not.toHaveAttribute('data-screen', 'battleTowers');
        }
        expect(settleAttempts).toBeGreaterThan(1);
        expect(paid).toBe(true);
        expect(errors).toEqual([]);
    });
}
