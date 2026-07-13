"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const root = process.cwd();
const read = (path) => (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, path), 'utf8');
(0, node_test_1.describe)('authoritative balance response migration', () => {
    (0, node_test_1.it)('daily login returns stored balances and the client assigns them', () => {
        const api = read('api/player/daily-login.ts');
        const client = read('shinobij.client/src/components/DailyBriefingModal.tsx');
        node_assert_1.strict.match(api, /balances:\s*\{\s*ryo:\s*out\.totalRyo,\s*fateShards:\s*out\.totalFateShards\s*\}/);
        node_assert_1.strict.match(client, /ryo:\s*res\.balances\.ryo/);
        node_assert_1.strict.match(client, /fateShards:\s*res\.balances\.fateShards/);
        node_assert_1.strict.doesNotMatch(client, /ryo:\s*prev\.ryo\s*\+\s*res\.granted\.ryo/);
    });
    (0, node_test_1.it)('weekly claims return stored balances and the client assigns them', () => {
        const api = read('api/missions/weekly-board.ts');
        const client = read('shinobij.client/src/components/WeeklyBoard.tsx');
        node_assert_1.strict.match(api, /balances:\s*\{\s*ryo:\s*num\(nextChar\.ryo\)/);
        node_assert_1.strict.match(client, /ryo:\s*res\.balances!\.ryo/);
        node_assert_1.strict.match(client, /fateShards:\s*res\.balances!\.fateShards/);
        node_assert_1.strict.doesNotMatch(client, /prev\.ryo\s*\+\s*\(reward\.ryo/);
    });
    (0, node_test_1.it)('village daily claims return stored balances and Town Hall assigns them', () => {
        const agenda = read('api/village/claim-daily-agenda.ts');
        const map = read('api/village/claim-map-control.ts');
        const client = read('shinobij.client/src/screens/TownHall.tsx');
        node_assert_1.strict.match(agenda, /balances:\s*\{\s*ryo:\s*num\(nextChar\.ryo\)/);
        node_assert_1.strict.match(map, /balances:\s*\{\s*ryo:\s*num\(nextChar\.ryo\)/);
        node_assert_1.strict.match(client, /ryo:\s*data\.personal\.balances\.ryo/);
        node_assert_1.strict.match(client, /ryo:\s*data\.balances\.ryo/);
        node_assert_1.strict.doesNotMatch(client, /ryo:\s*prev\.ryo\s*\+\s*grant\.ryo/);
    });
    (0, node_test_1.it)('pet reward clients assign balances committed by their server endpoints', () => {
        const gauntletApi = read('api/pet/gauntlet.ts');
        const gauntletClient = read('shinobij.client/src/components/PetGauntlet.tsx');
        const arenaApi = read('api/pet/battle-result.ts');
        const arenaClient = read('shinobij.client/src/screens/PetArena.tsx');
        const expeditionApi = read('api/missions/report-pet-event.ts');
        const expeditionClient = read('shinobij.client/src/screens/PetYard.tsx');
        node_assert_1.strict.match(gauntletApi, /balances,\s*score,\s*rank/);
        node_assert_1.strict.match(gauntletClient, /ryo:\s*rep\.balances\.ryo/);
        node_assert_1.strict.match(arenaApi, /balances:\s*\{\s*ryo:\s*Number\(updatedChar\.ryo\)\s*\}/);
        node_assert_1.strict.match(arenaClient, /ryo:\s*data\.balances\?\.ryo\s*\?\?\s*prev\.ryo/);
        node_assert_1.strict.match(expeditionApi, /balances:\s*\{\s*ryo:\s*Number\(finalChar\?\.ryo/);
        node_assert_1.strict.match(expeditionClient, /ryo:\s*Number\(data\.balances\?\.ryo\s*\?\?\s*prev\.ryo\)/);
        node_assert_1.strict.doesNotMatch(gauntletClient, /ryo:\s*\(c\.ryo\s*\?\?\s*0\)\s*\+\s*rep\.ryo/);
    });
    (0, node_test_1.it)('PvP bounty escrow and payout return committed ryo balances', () => {
        const api = read('api/pvp/bounty.ts');
        const app = read('shinobij.client/src/App.tsx');
        const hall = read('shinobij.client/src/screens/HallOfLegends.tsx');
        node_assert_1.strict.match(api, /balances:\s*\{\s*ryo:\s*debit\.balance\s*\}/);
        node_assert_1.strict.match(api, /balances:\s*\{\s*ryo:\s*credit\.balance\s*\}/);
        node_assert_1.strict.match(app, /ryo:\s*b\.balances\.ryo/);
        node_assert_1.strict.match(hall, /ryo:\s*res\.balances\?\.ryo\s*\?\?\s*prev\.ryo/);
        node_assert_1.strict.doesNotMatch(app, /ryo:\s*\(c\.ryo\s*\?\?\s*0\)\s*\+\s*b\.amount/);
    });
    (0, node_test_1.it)('AI fight XP and ryo come from the committed server character', () => {
        const api = read('api/missions/report-ai-fight.ts');
        const saveApi = read('api/save/[name].ts');
        const arena = read('shinobij.client/src/screens/Arena.tsx');
        node_assert_1.strict.match(api, /const leveled = gainXp\(character, reward\.xp\)/);
        node_assert_1.strict.match(api, /character: result\.character, _saveVersion: result\._saveVersion/);
        node_assert_1.strict.match(saveApi, /redeemedAiFightRewards/);
        node_assert_1.strict.match(arena, /aiFightTokenPromiseRef\.current = fetch\("\/api\/missions\/ai-fight-start"/);
        node_assert_1.strict.match(arena, /const tokenRequest = aiFightTokenPromiseRef\.current \?\? Promise\.resolve\(""\)/);
        node_assert_1.strict.match(arena, /updateCharacter\(buildWin\(data\?\.character\)\)/);
        node_assert_1.strict.match(api, /applyAiFightSecondaryRewards/);
        node_assert_1.strict.match(arena, /catch\(\(\) => updateCharacter\(\{ \.\.\.base, hp: playerHp \}\)\)/);
        node_assert_1.strict.match(arena, /if \(!serverCharacter\) return \{ \.\.\.base, hp: Math\.min\(base\.hp, playerHp\) \}/);
        node_assert_1.strict.doesNotMatch(arena, /ryo:\s*rewarded\.ryo \+ \(serverCharacter \? 0 : effRyo\)/);
    });
    (0, node_test_1.it)('story milestones consume the sealed next-boss token and adopt the committed character', () => {
        const api = read('api/story/settle.ts');
        const core = read('api/story/_settle.ts');
        const saveApi = read('api/save/[name].ts');
        const arena = read('shinobij.client/src/screens/Arena.tsx');
        const app = read('shinobij.client/src/App.tsx');
        node_assert_1.strict.match(api, /aiFightTokenKey\(playerName, token\)/);
        node_assert_1.strict.match(api, /applyStoryBossSettlement\(character, tokenData/);
        node_assert_1.strict.match(core, /token\.opponentId !== storyOpponentId\(village, levelReq\)/);
        node_assert_1.strict.match(saveApi, /char\.storyProgress = .*exChar\.storyProgress/);
        node_assert_1.strict.match(arena, /onPendingStoryBattleWin\?\.\(playerHp, token\)/);
        node_assert_1.strict.match(app, /fetch\('\/api\/story\/settle'/);
        node_assert_1.strict.match(app, /setCharacter\(data\.character\)/);
    });
    (0, node_test_1.it)('war crates are consumed and rewarded by one server save mutation', () => {
        const api = read('api/village/open-war-crate.ts');
        const client = read('shinobij.client/src/screens/Inventory.tsx');
        node_assert_1.strict.match(api, /mutatePlayerSave\(playerName/);
        node_assert_1.strict.match(api, /character: result\.character/);
        node_assert_1.strict.match(client, /fetch\("\/api\/village\/open-war-crate"/);
        node_assert_1.strict.match(client, /updateCharacter\(data\.character\)/);
        node_assert_1.strict.match(client, /if \(openingWarCrateRef\.current\) return/);
        node_assert_1.strict.doesNotMatch(client, /Math\.random\(\) < 0\.35/);
    });
    (0, node_test_1.it)('mission claims return and adopt the final committed character', () => {
        const api = read('api/missions/claim-mission.ts');
        const client = read('shinobij.client/src/lib/claim-mission.ts');
        node_assert_1.strict.match(api, /character: finalCharacter, _saveVersion: finalSaveVersion/);
        node_assert_1.strict.match(client, /if \(result\.character\) return \{ \.\.\.character, \.\.\.result\.character \}/);
    });
    (0, node_test_1.it)('bank interest adopts the committed bank balance', () => {
        const api = read('api/bank/claim-interest.ts');
        const client = read('shinobij.client/src/screens/Bank.tsx');
        node_assert_1.strict.match(api, /bankRyo: out\.bankRyo/);
        node_assert_1.strict.match(client, /bankRyo: data\.bankRyo \?\? prev\.bankRyo/);
        node_assert_1.strict.doesNotMatch(client, /bankRyo: prev\.bankRyo \+ claimed/);
    });
    (0, node_test_1.it)('player transfers return and adopt the committed sender balance', () => {
        const api = read('api/player/trade.ts');
        const client = read('shinobij.client/src/screens/Bank.tsx');
        node_assert_1.strict.match(api, /toPlayer: toDisplay, senderBalance/);
        node_assert_1.strict.match(client, /\[sendCurr\]: res\.senderBalance \?\?/);
    });
    (0, node_test_1.it)('bank deposits and withdrawals adopt the atomically committed character', () => {
        const api = read('api/bank/transfer.ts');
        const client = read('shinobij.client/src/screens/Bank.tsx');
        node_assert_1.strict.match(api, /mutatePlayerSave\(playerName/);
        node_assert_1.strict.match(client, /fetch\("\/api\/bank\/transfer"/);
        node_assert_1.strict.match(client, /updateCharacter\(data\.character\)/);
        node_assert_1.strict.doesNotMatch(client, /bankRyo: character\.bankRyo [+-] value/);
    });
    (0, node_test_1.it)('Hollow Gate settlement returns and adopts the committed character, including retries', () => {
        const api = read('api/hollow-gate/settle.ts');
        const client = read('shinobij.client/src/lib/hollow-gate-server.ts');
        node_assert_1.strict.match(api, /character: result\.character/);
        node_assert_1.strict.match(api, /reason: 'invalid-or-spent',[\s\S]*character: current\?\.character/);
        node_assert_1.strict.match(client, /return reconcileHollowGateSettle\(prev, entry, res\)/);
    });
    (0, node_test_1.it)('Battle Tower settlement exposes only and adopts the caller committed character', () => {
        const api = read('api/towers/settle.ts');
        const client = read('shinobij.client/src/screens/BattleTowerFight.tsx');
        node_assert_1.strict.match(api, /const responseSlug = callerSlug \?\? safeName\(playerName\)/);
        node_assert_1.strict.match(api, /character: committed\?\.character \?\? null/);
        node_assert_1.strict.match(client, /if \(response\.character\) \{[\s\S]*updateCharacter\(response\.character\)/);
    });
});
