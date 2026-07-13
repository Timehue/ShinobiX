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
        assert.match(arenaClient, /ryo:\s*data\.balances\?\.ryo\s*\?\?\s*prev\.ryo/);
        assert.match(expeditionApi, /balances:\s*\{\s*ryo:\s*Number\(finalChar\?\.ryo/);
        assert.match(expeditionClient, /ryo:\s*Number\(data\.balances\?\.ryo\s*\?\?\s*prev\.ryo\)/);
        assert.doesNotMatch(gauntletClient, /ryo:\s*\(c\.ryo\s*\?\?\s*0\)\s*\+\s*rep\.ryo/);
    });

    it('PvP bounty escrow and payout return committed ryo balances', () => {
        const api = read('api/pvp/bounty.ts');
        const app = read('shinobij.client/src/App.tsx');
        const hall = read('shinobij.client/src/screens/HallOfLegends.tsx');
        assert.match(api, /balances:\s*\{\s*ryo:\s*debit\.balance\s*\}/);
        assert.match(api, /balances:\s*\{\s*ryo:\s*credit\.balance\s*\}/);
        assert.match(app, /ryo:\s*b\.balances\.ryo/);
        assert.match(hall, /ryo:\s*res\.balances\?\.ryo\s*\?\?\s*prev\.ryo/);
        assert.doesNotMatch(app, /ryo:\s*\(c\.ryo\s*\?\?\s*0\)\s*\+\s*b\.amount/);
    });

    it('AI fight XP and ryo come from the committed server character', () => {
        const api = read('api/missions/report-ai-fight.ts');
        const saveApi = read('api/save/[name].ts');
        const arena = read('shinobij.client/src/screens/Arena.tsx');
        assert.match(api, /const leveled = gainXp\(character, reward\.xp\)/);
        assert.match(api, /character: result\.character, _saveVersion: result\._saveVersion/);
        assert.match(saveApi, /redeemedAiFightRewards/);
        assert.match(arena, /aiFightTokenPromiseRef\.current = fetch\("\/api\/missions\/ai-fight-start"/);
        assert.match(arena, /const tokenRequest = aiFightTokenPromiseRef\.current \?\? Promise\.resolve\(""\)/);
        assert.match(arena, /updateCharacter\(buildWin\(data\?\.character\)\)/);
        assert.match(api, /applyAiFightSecondaryRewards/);
        assert.match(arena, /catch\(\(\) => updateCharacter\(\{ \.\.\.base, hp: playerHp \}\)\)/);
        assert.match(arena, /if \(!serverCharacter\) return \{ \.\.\.base, hp: Math\.min\(base\.hp, playerHp\) \}/);
        assert.doesNotMatch(arena, /ryo:\s*rewarded\.ryo \+ \(serverCharacter \? 0 : effRyo\)/);
    });

    it('story milestones consume the sealed next-boss token and adopt the committed character', () => {
        const api = read('api/story/settle.ts');
        const core = read('api/story/_settle.ts');
        const saveApi = read('api/save/[name].ts');
        const arena = read('shinobij.client/src/screens/Arena.tsx');
        const app = read('shinobij.client/src/App.tsx');
        assert.match(api, /aiFightTokenKey\(playerName, token\)/);
        assert.match(api, /applyStoryBossSettlement\(character, tokenData/);
        assert.match(core, /token\.opponentId !== storyOpponentId\(village, levelReq\)/);
        assert.match(saveApi, /char\.storyProgress = .*exChar\.storyProgress/);
        assert.match(arena, /onPendingStoryBattleWin\?\.\(playerHp, token\)/);
        assert.match(app, /fetch\('\/api\/story\/settle'/);
        assert.match(app, /setCharacter\(data\.character\)/);
    });

    it('war crates are consumed and rewarded by one server save mutation', () => {
        const api = read('api/village/open-war-crate.ts');
        const client = read('shinobij.client/src/screens/Inventory.tsx');
        assert.match(api, /mutatePlayerSave\(playerName/);
        assert.match(api, /character: result\.character/);
        assert.match(client, /fetch\("\/api\/village\/open-war-crate"/);
        assert.match(client, /updateCharacter\(data\.character\)/);
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
        assert.match(client, /updateCharacter\(data\.character\)/);
        assert.doesNotMatch(client, /bankRyo: character\.bankRyo [+-] value/);
    });

    it('Hollow Gate settlement returns and adopts the committed character, including retries', () => {
        const api = read('api/hollow-gate/settle.ts');
        const client = read('shinobij.client/src/lib/hollow-gate-server.ts');
        assert.match(api, /character: result\.character/);
        assert.match(api, /reason: 'invalid-or-spent',[\s\S]*character: current\?\.character/);
        assert.match(client, /return reconcileHollowGateSettle\(prev, entry, res\)/);
    });

    it('Battle Tower settlement exposes only and adopts the caller committed character', () => {
        const api = read('api/towers/settle.ts');
        const client = read('shinobij.client/src/screens/BattleTowerFight.tsx');
        assert.match(api, /const responseSlug = callerSlug \?\? safeName\(playerName\)/);
        assert.match(api, /character: committed\?\.character \?\? null/);
        assert.match(client, /if \(response\.character\) \{[\s\S]*updateCharacter\(response\.character\)/);
    });
});
