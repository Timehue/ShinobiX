import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('authoritative balance response migration', () => {
    it('daily login returns stored balances and the client assigns them', () => {
        const api = read('api/player/daily-login.ts');
        const client = read('shinobij.client/src/components/DailyBriefingModal.tsx');
        assert.match(api, /balances:\s*\{\s*ryo:\s*out\.totalRyo,\s*fateShards:\s*out\.totalFateShards\s*\}/);
        assert.match(client, /ryo:\s*res\.balances\.ryo/);
        assert.match(client, /fateShards:\s*res\.balances\.fateShards/);
        assert.doesNotMatch(client, /ryo:\s*prev\.ryo\s*\+\s*res\.granted\.ryo/);
    });

    it('weekly claims return stored balances and the client assigns them', () => {
        const api = read('api/missions/weekly-board.ts');
        const client = read('shinobij.client/src/components/WeeklyBoard.tsx');
        assert.match(api, /balances:\s*\{\s*ryo:\s*num\(nextChar\.ryo\)/);
        assert.match(client, /ryo:\s*res\.balances!\.ryo/);
        assert.match(client, /fateShards:\s*res\.balances!\.fateShards/);
        assert.doesNotMatch(client, /prev\.ryo\s*\+\s*\(reward\.ryo/);
    });

    it('village daily claims return stored balances and Town Hall assigns them', () => {
        const agenda = read('api/village/claim-daily-agenda.ts');
        const map = read('api/village/claim-map-control.ts');
        const client = read('shinobij.client/src/screens/TownHall.tsx');
        assert.match(agenda, /balances:\s*\{\s*ryo:\s*num\(nextChar\.ryo\)/);
        assert.match(map, /balances:\s*\{\s*ryo:\s*num\(nextChar\.ryo\)/);
        assert.match(client, /ryo:\s*data\.personal\.balances\.ryo/);
        assert.match(client, /ryo:\s*data\.balances\.ryo/);
        assert.doesNotMatch(client, /ryo:\s*prev\.ryo\s*\+\s*grant\.ryo/);
    });

    it('pet reward clients assign balances committed by their server endpoints', () => {
        const gauntletApi = read('api/pet/gauntlet.ts');
        const gauntletClient = read('shinobij.client/src/components/PetGauntlet.tsx');
        const arenaApi = read('api/pet/battle-result.ts');
        const arenaClient = read('shinobij.client/src/screens/PetArena.tsx');
        const expeditionApi = read('api/missions/report-pet-event.ts');
        const expeditionClient = read('shinobij.client/src/screens/PetYard.tsx');
        assert.match(gauntletApi, /balances,\s*score,\s*rank/);
        assert.match(gauntletClient, /ryo:\s*rep\.balances\.ryo/);
        assert.match(arenaApi, /balances:\s*\{\s*ryo:\s*Number\(updatedChar\.ryo\)\s*\}/);
        const applyArenaSettlement = arenaClient.slice(
            arenaClient.indexOf('const applyPetBattleSettlement'),
            arenaClient.indexOf('async function postPetBattleSettlement'),
        );
        assert.match(applyArenaSettlement, /if \(!data\.character\) throw new Error/);
        assert.match(applyArenaSettlement, /const decision = receivePetBattleSettlement\(data, scope, authoritativeCharacter\)/);
        assert.ok(
            applyArenaSettlement.indexOf('if (decision === "stale")')
                < applyArenaSettlement.indexOf('updateCharacter((current) =>'),
            'Pet Arena must version-check the committed snapshot before adopting it',
        );
        assert.match(applyArenaSettlement, /const authoritativeCharacter = \{\s*\.\.\.data\.character,\s*pets:/);
        assert.doesNotMatch(applyArenaSettlement, /ryo:\s*[^\n]*\+/,
            'Pet Arena must adopt server balances through the committed character, never client reward arithmetic');
        assert.match(expeditionApi, /balances:\s*\{\s*ryo:\s*Number\(finalChar\?\.ryo/);
        const collectExpedition = expeditionClient.slice(
            expeditionClient.indexOf('async function collectExpedition'),
            expeditionClient.indexOf('async function collectTraining'),
        );
        assert.match(collectExpedition, /if \(data\.character && !onVersionedCharacter\(data\.character, data\._saveVersion\)\) return/);
        assert.match(collectExpedition, /if \(!data\.character\) throw new Error/);
        assert.doesNotMatch(collectExpedition, /updateCharacter\([^)]*ryo|ryo:\s*[^\n]*\+/,
            'Pet Yard must adopt the committed character balance, not synthesize expedition ryo');
        assert.doesNotMatch(gauntletClient, /ryo:\s*\(c\.ryo\s*\?\?\s*0\)\s*\+\s*rep\.ryo/);
    });

    it('PvP bounty escrow and payout return committed ryo balances', () => {
        const api = read('api/pvp/bounty.ts');
        const app = read('shinobij.client/src/App.tsx');
        // Bounty placement now lives in the Battle Arena "Bounty Board" tab
        // (BountyBoardPanel); the Hall of Legends duplicate was retired.
        const panel = read('shinobij.client/src/components/BountyBoardPanel.tsx');
        assert.match(api, /balances:\s*\{\s*ryo:\s*debit\.balance\s*\}/);
        assert.match(api, /balances:\s*\{\s*ryo:\s*credit\.balance\s*\}/);
        // App no longer assigns bounty ryo itself. The settled owner save is
        // adopted wholesale through commitVersionedCharacter and the bounty
        // branch only notifies, which is strictly stronger than the previous
        // `ryo: b.balances.ryo` field adoption.
        assert.match(app, /commitVersionedCharacter\(ownerSave\.character, ownerSave\.version\)/);
        assert.match(app, /if \(projection\.bounty\) \{[\s\S]{0,240}gameToast\(`💰 Bounty:/);
        assert.doesNotMatch(app, /ryo:[^\n]*\bbounty\b[^\n]*\.amount/i,
            'App must not self-assign bounty ryo');
        assert.match(panel, /ryo:\s*res\.balances\?\.ryo\s*\?\?\s*character\.ryo/);
        assert.doesNotMatch(app, /ryo:\s*\(c\.ryo\s*\?\?\s*0\)\s*\+\s*b\.amount/);
    });

    it('AI fight XP and ryo come from the committed server character', async () => {
        const api = read('api/missions/report-ai-fight.ts');
        const host = read('shinobij.client/src/components/AiFightHost.tsx');
        const settle = read('shinobij.client/src/lib/ai-fight-settle.ts');
        const app = read('shinobij.client/src/App.tsx');
        assert.match(api, /readSoloPveSession\(sealedSessionId\)/);
        assert.match(api, /const settledUsageSession = usage\.session/);
        assert.match(api, /applySoloPveUsageCosts\(character, settledUsageSession\)/);
        assert.match(api, /const leveled = gainXp\(companionCharacter, reward\.xp\)/);
        assert.match(api, /character: finalCharacter,\s*_saveVersion: finalSaveVersion/);
        // The save endpoint's protection of the AI-fight redemption ledger now
        // derives from the ownership manifest (P0-1) — assert it there, where
        // the boundary is actually defined.
        const ownership = await import('./save/_state-ownership.js');
        assert.ok(
            ownership.SERVER_ARRAY_LEDGER_CHARACTER_FIELDS.includes('redeemedAiFightRewards'),
            'redeemedAiFightRewards must stay a server-owned redemption ledger on the save path',
        );
        assert.match(host, /startAiFight\(\{/);
        assert.match(host, /const settled = await settleAiFight\(\{/);
        assert.match(host, /latestOnSettled\.current\(settled\)/);
        assert.match(settle, /const settledCharacter = \(reported\.character \?\? null\)/);
        assert.match(api, /applyAiFightSecondaryRewards/);
        // The mounted host adopts only the committed character returned through
        // the settlement helper; no client reward arithmetic survives.
        assert.match(app, /onSettled=\{\(result\) => \{\s*if \(result\.character && !commitVersionedCharacter\(result\.character, result\._saveVersion\)\) return;/);
        assert.doesNotMatch(settle, /ryo:\s*\([^\n]*\+|xp:\s*\([^\n]*\+/, 'the client must not synthesize AI fight balances');
    });

    it('story milestones consume the sealed next-boss token and adopt the committed character', () => {
        const api = read('api/story/settle.ts');
        const core = read('api/story/_settle.ts');
        const saveApi = read('api/save/[name].ts');
        const client = read('shinobij.client/src/lib/story-combat-api.ts');
        const host = read('shinobij.client/src/components/StoryBossFightHost.tsx');
        const app = read('shinobij.client/src/App.tsx');
        assert.match(api, /const session = await readSoloPveSession\(runId\)/);
        assert.match(api, /const redemptionKey = `run:\$\{runId\}`/);
        assert.match(api, /redeemed\.find\(\(entry\) => entry\.token === redemptionKey\)/);
        assert.match(api, /replayed:\s*true/);
        assert.match(api, /applySoloPveUsageCosts\(character, session!\)/);
        assert.match(api, /applyStoryBossSettlement\([\s\S]*validation\.binding\.opponentId/);
        assert.match(core, /proof\.opponentId !== storyOpponentId\(village, levelReq\)/);
        assert.match(saveApi, /char\.storyProgress = .*exChar\.storyProgress/);
        assert.match(client, /fetch\('\/api\/story\/settle'/);
        assert.match(client, /body: JSON\.stringify\(\{ \.\.\.params, kind: 'storyBoss' \}\)/);
        assert.match(host, /onSettled\(settled\)/);
        assert.match(app, /function handleServerStoryBossSettled\(result: StoryBossSettleResult\)[\s\S]{0,260}?commitVersionedCharacter\(result\.character, result\._saveVersion\)/);
        assert.match(app, /function commitVersionedCharacter[\s\S]{0,420}?acceptVersionedSnapshot\(latestSaveVersionRef\.current, incomingVersion\)/);
    });

    it('war crates are consumed and rewarded by one server save mutation', () => {
        const api = read('api/village/open-war-crate.ts');
        const client = read('shinobij.client/src/screens/Inventory.tsx');
        assert.match(api, /mutatePlayerSave\(playerName/);
        assert.match(api, /character: result\.character/);
        assert.match(client, /fetch\("\/api\/village\/open-war-crate"/);
        assert.match(client, /onVersionedCharacter\(data\.character, data\._saveVersion\)/);
        assert.match(client, /if \(openingWarCrateRef\.current\) return/);
        assert.doesNotMatch(client, /Math\.random\(\) < 0\.35/);
    });

    it('mission claims return and adopt the final committed character', () => {
        const api = read('api/missions/claim-mission.ts');
        const client = read('shinobij.client/src/lib/claim-mission.ts');
        assert.match(api, /character: finalCharacter, _saveVersion: finalSaveVersion/);
        assert.match(client, /if \(result\.character\) return \{ \.\.\.character, \.\.\.result\.character \}/);
    });

    it('bank interest adopts the committed bank balance', () => {
        const api = read('api/bank/claim-interest.ts');
        const client = read('shinobij.client/src/screens/Bank.tsx');
        assert.match(api, /bankRyo: out\.bankRyo/);
        assert.match(client, /bankRyo: data\.bankRyo \?\? prev\.bankRyo/);
        assert.doesNotMatch(client, /bankRyo: prev\.bankRyo \+ claimed/);
    });

    it('player transfers return and adopt the committed sender balance', () => {
        const api = read('api/player/trade.ts');
        const client = read('shinobij.client/src/screens/Bank.tsx');
        assert.match(api, /toPlayer: toDisplay, senderBalance/);
        assert.match(client, /\[sendCurr\]: res\.senderBalance \?\?/);
    });

    it('bank deposits and withdrawals adopt the atomically committed character', () => {
        const api = read('api/bank/transfer.ts');
        const client = read('shinobij.client/src/screens/Bank.tsx');
        assert.match(api, /mutatePlayerSave\(playerName/);
        assert.match(client, /fetch\("\/api\/bank\/transfer"/);
        assert.match(client, /onVersionedCharacter\(data\.character, data\._saveVersion\)/);
        assert.doesNotMatch(client, /bankRyo: character\.bankRyo [+-] value/);
    });

    it('Hollow Gate settlement returns and adopts the committed character, including retries', () => {
        const api = read('api/hollow-gate/settle.ts');
        const client = read('shinobij.client/src/lib/hollow-gate-server.ts');
        assert.match(api, /character: result\.character/);
        assert.match(api, /alreadyReported: true, character: result\.character, _saveVersion: result\._saveVersion/);
        assert.match(client, /if \(!res\?\.ok \|\| !res\.character\)/);
        assert.match(client, /return reconcileHollowGateSettle\(prev, res\)/);
    });

    it('Battle Tower settlement exposes only and adopts the caller committed character', () => {
        const api = read('api/towers/settle.ts');
        const client = read('shinobij.client/src/screens/BattleTowerFight.tsx');
        assert.match(api, /const responseSlug = callerSlug \?\? safeName\(playerName\)/);
        assert.match(api, /character: committed\?\.character \?\? null/);
        assert.match(client, /if \(mutation\.character\) onVersionedCharacter\?\.\(mutation\.character, mutation\._saveVersion\)/);
    });
});
