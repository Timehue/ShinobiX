import { useCallback, useEffect, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { BattleTowerFight } from "./BattleTowerFight";
import { fetchTowerPvpSession, submitTowerPvpActionWithLostResponseRetry, type TowerPvpMatch } from "../lib/tower-pvp-api";
import { readClanWar2v2Stash, settleClanWar2v2, startClanWar2v2 } from "../lib/clan-war-2v2-api";

/*
 * Clan War shinobi 2v2 screen.
 *
 * Deliberately thin. The fight is the SAME four-player board the public Tower
 * Team Arena uses, so this screen only resolves the match for the accepted
 * challenge and hands it to BattleTowerFight with a clan-war settleFn. There is
 * no second combat implementation to keep in sync — `settleFn` is the reuse seam
 * the Clan Boss already rides on.
 *
 * Entry is idempotent: all four members call `start`, and the server converges
 * them onto one published match, so a reload or a late joiner lands in the same
 * fight rather than minting a second one.
 */
export function ClanWar2v2Battle({ character, setScreen }: { character: Character; setScreen: (s: Screen) => void }) {
    const stash = readClanWar2v2Stash();
    const warId = String(stash.warId ?? "");
    const challengeId = String(stash.challengeId ?? "");
    const [match, setMatch] = useState<TowerPvpMatch | null>(null);
    const [error, setError] = useState<string | null>(null);
    const mountedRef = useRef(true);

    const back = useCallback(() => setScreen("clan"), [setScreen]);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        // A missing binding is derived below at render time, not stored: setting
        // state synchronously in an effect just to describe the props we already
        // have causes a cascading render for no gain.
        if (!warId || !challengeId) return;
        let alive = true;
        startClanWar2v2(character.name, warId, challengeId)
            .then(resolved => { if (alive) setMatch(resolved); })
            .catch(startError => { if (alive) setError(String((startError as Error)?.message ?? startError)); });
        return () => { alive = false; };
    }, [challengeId, character.name, warId]);

    const missingDuel = !warId || !challengeId;

    if (error || missingDuel) {
        return (
            <div className="clan-war-2v2-gate" role="alert" style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
                <h2>⚔ Clan War 2v2</h2>
                <p>{error ?? "No Clan War duel is selected."}</p>
                <button type="button" onClick={back}>← Back to Clan Hall</button>
            </div>
        );
    }

    if (!match) {
        return (
            <div className="clan-war-2v2-gate" role="status" style={{ maxWidth: 640, margin: "2rem auto", padding: "0 1rem" }}>
                <h2>⚔ Clan War 2v2</h2>
                <p>Assembling both pairs on the battlefield…</p>
            </div>
        );
    }

    return (
        <BattleTowerFight
            character={character}
            runId={match.matchId}
            initialSession={match.combat}
            stateFn={fetchTowerPvpSession}
            actionRetryFn={submitTowerPvpActionWithLostResponseRetry}
            // Clan-war settlement, not the zero-reward Team Arena acknowledgement.
            // /api/towers/pvp-settle refuses this match outright, so the war HP can
            // only ever be applied through here.
            settleFn={settleClanWar2v2(challengeId)}
            settleOnAnyDone
            variant="team-pvp"
            onExit={back}
        />
    );
}
