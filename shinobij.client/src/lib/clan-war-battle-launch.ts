import type {Biome,WeatherType,Screen} from '../types/core';
import type {usePvpSessionController} from './use-pvp-session-controller';
import {sharedClanWarCache,type CwChallenge} from './clan-war-api';
import {clanWarLaunchOrigin} from './clan-war-launch-origin';
import {stringifyPvpSessionPayload,pvpSessionEnvironment} from './pvp-session';
import {weatherEffects} from '../data/world';

type LaunchContext=Pick<ReturnType<typeof usePvpSessionController>,
    'setPvpSeedSession'|'setPvpBattleId'|'setPvpRole'|'setPvpBattleContext'|'installPvpRecovery'> & {
    ownerName:string;currentBiome:Biome;currentWeather:WeatherType;setScreen:(screen:Screen)=>void;
    capturePvpCreateScope:(ownerName:string)=>{signal:AbortSignal;isCurrent:()=>boolean};
    loadPvpSessionCreate:()=>Promise<typeof import('./pvp-session-create')>;
};

/** Routes the accepted server match through its existing battle host. */
export function launchClanWarBattle(context:LaunchContext,ch:CwChallenge,warId?:string,onLaunchFailed?:()=>void) {
    const {ownerName,currentBiome,currentWeather,capturePvpCreateScope,loadPvpSessionCreate,installPvpRecovery,
        setScreen,setPvpSeedSession,setPvpBattleId,setPvpRole,setPvpBattleContext}=context;
    const me = ownerName.toLowerCase();
    const onFromSide = (ch.fromPlayer ?? "").toLowerCase() === me
        || (ch.fromPlayer2 ?? "").toLowerCase() === me;
    // Stash the server-matched context for battle and return;
    // Browser navigation never decides battle or reward authority.
    const inferredWarId = warId ?? Object.values(sharedClanWarCache).find(w => w.pendingChallenges.some(c => c.id === ch.id))?.id ?? "";
    const origin = clanWarLaunchOrigin(sharedClanWarCache[inferredWarId], ch.campaignMatchId);
    try {
        sessionStorage.setItem("clanWarChallenge.v1", JSON.stringify({
            warId: inferredWarId,
            challengeId: ch.id,
            mode: ch.mode,
            fromClan: ch.fromClan,
            fromPlayer: ch.fromPlayer,
            fromPlayer2: ch.fromPlayer2 ?? null,
            acceptedPlayer: ch.acceptedPlayer ?? null,
            acceptedPlayer2: ch.acceptedPlayer2 ?? null,
            battleId: ch.battleId ?? null,
            petBattleSeed: ch.petBattleSeed ?? null,
            stashedAt: Date.now(), ...origin,
        }));
    } catch { /* sessionStorage may be unavailable */ }

    switch (ch.mode) {
        case "pvp2v2": {
            // Four-player board; ClanWar2v2Battle resolves the match itself.
            if (inferredWarId) setScreen("clanWar2v2"); else onLaunchFailed?.();
            break;
        }
        case "pvp1v1": {
            const p1Name = ch.fromPlayer ?? "";
            const p2Name = ch.acceptedPlayer ?? "";
            if (!inferredWarId || !p1Name || !p2Name) {
                alert("This accepted Clan War duel is missing its server match details. Refresh and try again.");
                onLaunchFailed?.(); return;
            }
            void (async () => {
                const createScope = capturePvpCreateScope(ownerName);
                const requestBody = stringifyPvpSessionPayload({
                    clanWarId: inferredWarId,
                    clanWarChallengeId: ch.id,
                    baseRewards: true,
                    ...pvpSessionEnvironment(false, currentBiome, weatherEffects[currentWeather]?.positiveElement, weatherEffects[currentWeather]?.negativeElement),
                    p1Character: { name: p1Name },
                    p2Character: { name: p2Name },
                });
                try {
                    const result = await (await loadPvpSessionCreate()).createPvpSessionWithRecovery(fetch, ownerName, requestBody, {
                        signal: createScope.signal, isCurrent: createScope.isCurrent,
                    });
                    if (!createScope.isCurrent()) return;
                    if (result.kind === "recovered") {
                        installPvpRecovery(result.pending);
                        setScreen("pvpBattle");
                        return;
                    }
                    if (result.kind === "rejected") { alert(result.error); onLaunchFailed?.(); return; }
                    const battleId = result.kind === "created" ? result.battleId : result.battleId;
                    try {
                        const raw = sessionStorage.getItem("clanWarChallenge.v1");
                        const stashed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
                        sessionStorage.setItem("clanWarChallenge.v1", JSON.stringify({ ...stashed, battleId }));
                    } catch { /* optional resume breadcrumb */ }
                    if (result.kind === "created") setPvpSeedSession(result.session);
                    setPvpBattleId(battleId);
                    setPvpRole(onFromSide ? "p1" : "p2");
                    setPvpBattleContext({ mode: "clanWar1v1", clanWarChallengeId: ch.id, clanWarReturnScreen: origin.returnScreen });
                    setScreen("pvpBattle");
                    if (result.kind === "ambiguous") alert("The battle response was interrupted. Reconnecting to the authoritative session…");
                } catch (error) {
                    if (createScope.isCurrent() && !(error instanceof DOMException && error.name === "AbortError")) {
                        alert("Could not create the authoritative Clan War battle."); onLaunchFailed?.();
                    }
                }
            })();
            break;
        }
        case "pet1v1":
        case "pet2v2":
            // SERVER-AUTHORITATIVE: both sides field a pet through
            // /api/clan/war/pet, the server runs the deterministic duel and
            // finalizes the challenge, and this screen replays it. Nothing is
            // reported from the client — /api/clan/war/report refuses pet
            // results outright.
            setScreen("clanWarPet");
            break;
        case "tilecards": {
            // Chronicle Showdown joins idempotently from the battle screen. The
            // server owns deck validation, rules, timeouts and finalization.
            setScreen("tilecardsDuel");
            break;
        }
    }
}
