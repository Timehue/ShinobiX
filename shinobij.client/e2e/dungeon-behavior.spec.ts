import { expect, test } from '@playwright/test';
import { buildSoloPveAiEncounter } from '../../api/solo-pve/_ai-encounter';
import { applySoloPveAction } from '../../api/solo-pve/_engine';
import { STANDARD_PVE_AI_POLICY } from '../../api/solo-pve/_ai-turn-policy';
import { resolveDungeonAiFightAuthority } from '../../api/dungeon/_ai-fight';
import { mutateDungeonRun } from '../../api/dungeon/_run';
import { aiStatsForLevel } from '../../api/_ai-level-curves';
import { hexNeighbors } from '../../api/combat-core/grid';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(info.project.name), 'Dungeon flow coverage on desktop and phone.');
});

function dungeonSave(entry: 'key' | 'free', complete = false) {
    const save = uiAuditSave();
    const run = { token: 'dungeonbehaviorrun01', entry, sector: 66, startedAt: Date.now() - 60_000,
        presentationEventId: 'builtin-hidden-dungeon', ...(entry === 'free' ? { exploreReceiptId: 'dungeonexplore01' } : {}),
        ...(complete ? { combatAuthorityVersion: 1, wardenDefeated: true, wardenProofId: 'wardenproof001',
            cardAuthorityVersion: 1, cardDefeated: true, cardLastOutcome: 'player', cardSettledAt: 1, cardDefeatedAt: 1,
            cardProofId: 'cardproof001', cardLastProofId: 'cardproof001',
            petAuthorityVersion: 1, petDefeated: true, petLastOutcome: 'win', petSettledAt: 1, petDefeatedAt: 1,
            petProofId: 'petproof001', petLastProofId: 'petproof001', petLastPetIds: ['dungeonpet001'] } : {}),
    };
    save.currentSector = 66;
    save.character = { ...save.character, level: 100, storyProgress: 9, stats: aiStatsForLevel(100),
        hp: 10_000, maxHp: 10_000, activeDungeonRun: run };
    return { save, run };
}

for (const entry of ['key', 'free'] as const) {
    test(`${entry} Dungeon Warden advances only after saved victory and returns to its entry screen`, async ({ page }, info) => {
        const { save, run } = dungeonSave(entry);
        const runtime = await installUiAuditRuntime(page, save);
        const authority = resolveDungeonAiFightAuthority({ playerName: 'auditninja', character: save.character!, dungeonRunToken: run.token });
        let session = buildSoloPveAiEncounter({ sessionId: `dungeon-ui-${entry}`, playerName: 'auditninja', save,
            profile: authority.profile, scaling: authority.scaling, admin: null, now: Date.now(),
            difficultyMode: 'AI_FIGHT', aiTurnPolicy: STANDARD_PVE_AI_POLICY,
            encounter: { kind: 'generic-ai', id: authority.opponentId, sourceId: authority.opponentId } });
        session.enemy.hp = 1; session.enemy.pos = hexNeighbors(session.player.pos)[0];
        let reportCalls = 0, abandonCalls = 0;
        let allowReport = false;
        await page.route('**/api/missions/ai-fight-start', route => {
            const body = route.request().postDataJSON();
            if (body.resumeWorldFight || body.resumeAiFight) return route.fulfill({ status: 204 });
            expect(body.dungeonRunToken).toBe(run.token);
            return route.fulfill({ json: { token: 'dungeon-fight-token', sessionId: session.sessionId, session,
                opponentId: authority.opponentId, opponentName: session.enemy.name, battleKind: 'dungeon' } });
        });
        await page.route('**/api/solo-pve/state?**', route => route.fulfill({ json: { session } }));
        await page.route('**/api/solo-pve/action', route => {
            const result = applySoloPveAction(session, route.request().postDataJSON());
            expect(result.applied).toBe(true); session = { ...result.session, version: session.version + 1 };
            return route.fulfill({ json: { ...result, session } });
        });
        await page.route('**/api/missions/report-ai-fight', route => {
            expect(session.winner).toBe('player');
            reportCalls++;
            if (!allowReport) return route.fulfill({ status: 503, json: { error: 'Temporary dungeon result outage.' } });
            const character = { ...runtime.serverSave().character, hp: session.player.hp,
                activeDungeonRun: { ...run, combatAuthorityVersion: 1, wardenDefeated: true, wardenProofId: 'wardenproof001' } };
            const version = runtime.currentVersion() + 1; runtime.commitServerCharacter(character, version);
            return route.fulfill({ json: { ok: true, outcome: 'win', ryo: 0, statPoints: 0, xp: 0, character, _saveVersion: version } });
        });
        await page.route('**/api/dungeon/run', route => {
            expect(route.request().postDataJSON().action).toBe('abandon'); abandonCalls++;
            const character = { ...runtime.serverSave().character, activeDungeonRun: null };
            const version = runtime.currentVersion() + 1; runtime.commitServerCharacter(character, version);
            return route.fulfill({ json: { character, token: run.token, _saveVersion: version } });
        });
        await page.goto('/#/dungeon', { waitUntil: 'domcontentloaded' });
        const stage = page.locator('.cvn-root');
        await expect(stage).toBeVisible();
        const challenge = page.getByRole('button', { name: 'Challenge Seal One', exact: true });
        while (!await challenge.isVisible()) await stage.getByRole('button', { name: 'Next', exact: true }).click();
        await challenge.click();
        await expect(page.locator('.mission-arena-fight')).toBeVisible();
        await expect(stage).toHaveCount(0);
        await page.keyboard.press('Escape');
        expect(abandonCalls).toBe(0);
        await page.locator('.mission-arena-fight').getByRole('button', { name: /^Attack\b/ }).click();
        await page.locator('.mission-arena-fight button.hex-tile.hex-enemy.jutsu-target-tile').click();
        const result = page.getByRole('dialog', { name: 'Fight won', exact: true });
        await expect(result.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
        expect(runtime.serverSave().character?.activeDungeonRun?.wardenDefeated).not.toBe(true);
        allowReport = true;
        await result.getByRole('button', { name: 'Retry', exact: true }).click();
        await expect(result).toContainText('No direct ryo or stat points were awarded');
        expect(reportCalls).toBeGreaterThan(1);
        await result.getByRole('button', { name: 'Continue', exact: true }).click();
        await expect(page.locator('.mission-arena-fight')).toHaveCount(0);
        await expect(stage).toBeVisible();
        await expect(stage).toContainText('Chronicle');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(stage).toContainText('Chronicle');
        await page.screenshot({ path: info.outputPath(`dungeon-${entry}-next-seal.png`), fullPage: true });
        await stage.getByRole('button', { name: 'Leave', exact: true }).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', entry === 'key' ? 'centralHub' : 'worldMap');
        expect(abandonCalls).toBe(1);
        expect(runtime.serverSave().character?.activeDungeonRun).toBeNull();
    });

    test(`${entry} completed Dungeon keeps a failed claim recoverable and exits after one reward`, async ({ page }, info) => {
        const { save, run } = dungeonSave(entry, true);
        const runtime = await installUiAuditRuntime(page, save);
        let attempts = 0, paid = 0;
        await page.route('**/api/dungeon/run', route => {
            const body = route.request().postDataJSON(); expect(body.action).toBe('settle');
            if (++attempts === 1) return route.fulfill({ status: 503, json: { error: 'Temporary claim outage.' } });
            const settled = mutateDungeonRun(runtime.serverSave().character!, 'settle', run.token, '', Date.now(), 1);
            expect(settled.ok).toBe(true); if (!settled.ok) throw new Error(settled.reason);
            paid++;
            const version = runtime.currentVersion() + 1; runtime.commitServerCharacter(settled.character, version);
            return route.fulfill({ json: { ...settled, token: run.token, _saveVersion: version } });
        });
        await page.goto('/#/dungeon', { waitUntil: 'domcontentloaded' });
        const claim = page.getByRole('button', { name: 'Claim dungeon reward', exact: true });
        await expect(claim).toBeVisible(); await claim.click();
        const notice = page.getByRole('alertdialog', { name: 'Notice', exact: true });
        await expect(notice).toContainText('Temporary claim outage.');
        await notice.getByRole('button', { name: 'OK', exact: true }).click();
        expect(runtime.serverSave().character?.activeDungeonRun).not.toBeNull();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(claim).toBeVisible(); await claim.evaluate(button => { button.click(); button.click(); });
        await expect(notice).toContainText('cleared.');
        await notice.getByRole('button', { name: 'OK', exact: true }).click();
        await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', entry === 'key' ? 'centralHub' : 'worldMap');
        expect(paid).toBe(1); expect(attempts).toBe(2);
        expect(runtime.serverSave().character?.activeDungeonRun).toBeNull();
        expect(runtime.serverSave().character?.inventory).toContain('dungeon-legendary-relic');
        await page.screenshot({ path: info.outputPath(`dungeon-${entry}-claimed-return.png`), fullPage: true });
    });
}
