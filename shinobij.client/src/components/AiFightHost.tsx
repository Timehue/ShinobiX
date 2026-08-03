import { Suspense, useEffect, useRef, useState } from "react";
import type { Character, BattleHistoryEntry } from "../types/character";
import type { TowerSession } from "../lib/towers-api";
import type { SavedBloodline, Jutsu, GameItem } from "../types/combat";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { startAiFight } from "../lib/ai-fight-api";
import { aiFightHostLoadout } from "../lib/ai-fight-loadout";
import { onAiFightRequest, type AiFightRequest } from "../lib/ai-fight-request";
import {
    settleAiFight,
    shouldSettleOnClose,
    stampAiFightOutcome,
    type AiFightSettleHooks,
    type AiFightSettleResult,
} from "../lib/ai-fight-settle";
import { damageSectorTerritory, sectorRaidDamageAmount } from "../lib/world-state";

/** The shared sector-territory hit a raid win lands. Composed here rather than in
 *  lib/ai-fight-settle so that module stays free of world-state's App back-edge. */
function applySectorRaidDamage(sector: number): void {
    const amount = sectorRaidDamageAmount(sector);
    if (amount > 0) damageSectorTerritory(sector, amount);
}

// AI fights render through MissionArenaFight — the SAME server-authoritative arena
// shell combat missions and story bosses use (a sealed tower:<runId> session,
// /api/towers/action moves, the 12×10 hex board). MissionArenaFight portals itself
// to <body>, so the fight covers whatever screen the player launched from and no
// navigation is needed. App mounts THIS host eagerly so its request-bus listener is
// always live; the screen is code-split and warmed on the request, in parallel with
// the start round-trip, so it is resident by the time the session opens.
const MissionArenaFight = lazyWithRetry(() => import("../screens/MissionArenaFight").then((m) => ({ default: m.MissionArenaFight })));

type ActiveFight = { request: AiFightRequest; token: string; runId: string; session: TowerSession };

/*
 * The single host for sealed AI fights (api/missions/ai-fight-start), mounted once
 * in App. Every launch site that fights a CATALOG AI — hunts, apex, village guards,
 * wanderers, explore ambushes, sector raids, field/E-rank missions — emits one
 * request on lib/ai-fight-request and this host decides the screen:
 *
 *   sealed encounter  → MissionArenaFight (server-resolved)
 *   nothing sealed    → request.playLocally() (the local Arena, unchanged)
 *
 * The second branch is the DESIGNED DEGRADE, not a feature gate: a client-authored
 * `temp-*` opponent the catalog cannot resolve, a storage error, or any failed seal
 * must still produce a fight.
 *
 * The fight is started BEFORE the screen is chosen. The old path minted its token
 * from a `battleStarted` effect INSIDE Arena, so the runId only arrived once the
 * local fight was already underway — too late to route anything.
 */
export function AiFightHost({
    character,
    sharedImages,
    savedBloodlines,
    creatorJutsus,
    creatorItems,
    hooks,
    onSettled,
    onClose,
    onRecordBattle,
}: {
    character: Character | null;
    sharedImages: Record<string, string>;
    /** The player's own catalogs — the SEALED session carries combat fields but NO
     *  art, so card thumbnails resolve from these by id. */
    savedBloodlines?: SavedBloodline[];
    creatorJutsus?: Jutsu[];
    creatorItems?: GameItem[];
    /** The world/mission side effects the server does not own (see lib/ai-fight-settle). */
    hooks?: AiFightSettleHooks;
    onSettled: (result: AiFightSettleResult) => void;
    onClose?: (returnScreen?: string) => void;
    /** Profile → Battles reflection log, same as the local Arena records. */
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
}) {
    const [fight, setFight] = useState<ActiveFight | null>(null);
    const startingRef = useRef(false);
    // One settle per fight. The screen settles on resolve; closeFight settles an
    // ABANDONED fight (the server scores that a forfeit), and this stops the two
    // from both firing when the player closes an already-resolved result card.
    const settledRef = useRef(false);
    const playerName = character?.name ?? "";
    // Read through a ref so the subscription does not resubscribe (and drop the
    // single-listener registration) every time a catalog prop changes identity.
    // Updated in an effect, not during render: a bus request always arrives from
    // a user interaction, i.e. after the commit that refreshed this.
    const latest = useRef({ character, creatorItems, savedBloodlines });
    useEffect(() => { latest.current = { character, creatorItems, savedBloodlines }; });
    // `fight` itself is not readable from the bus callback (it closes over the
    // mount render), so mirror "a fight is on screen" into a ref.
    const activeRef = useRef(false);
    useEffect(() => { activeRef.current = fight !== null; }, [fight]);

    useEffect(() => {
        if (!playerName) return;
        return onAiFightRequest((request) => {
            const me = latest.current.character;
            if (!me) return request.playLocally();
            // One fight at a time. A second request while a start is in flight —
            // or while a fight is already on screen — is dropped rather than
            // queued: two sealed encounters would mint two tokens for one
            // intended fight, and the second would silently replace the first,
            // leaving the abandoned run to be scored a forfeit.
            if (startingRef.current || activeRef.current) return;
            startingRef.current = true;
            settledRef.current = false;
            void import("../screens/MissionArenaFight");
            startAiFight({
                playerName: me.name,
                opponentId: request.opponentId,
                opponentLevel: request.opponentLevel,
                battleKind: request.battleKind,
                hostLoadout: aiFightHostLoadout(me, latest.current.creatorItems, latest.current.savedBloodlines),
            })
                .then((started) => {
                    if (started.runId && started.session) {
                        setFight({ request, token: started.token, runId: started.runId, session: started.session });
                    } else {
                        // No encounter sealed → the local Arena plays this fight,
                        // which mints its own token from inside the battle. The
                        // token minted above simply expires unspent.
                        request.playLocally();
                    }
                })
                .finally(() => { startingRef.current = false; });
        });
    }, [playerName]);

    if (!fight || !character) return null;
    const request = fight.request;
    const opponentName = request.opponentName ?? "the enemy";

    // Redeem the sealed token and apply the client-owned counters. The server pays
    // from the token (battleKind + opponentId sealed at start), so there is no
    // client-supplied amount here to inflate.
    async function settle(_runId: string, settlingPlayer: string): Promise<AiFightSettleResult> {
        settledRef.current = true;
        const settled = await settleAiFight({
            playerName: settlingPlayer,
            token: fight!.token,
            opponentId: fight!.request.opponentId,
            battleKind: fight!.request.battleKind,
            sector: fight!.request.sector,
            hooks: { onSectorRaidDamage: applySectorRaidDamage, ...hooks },
        });
        onSettled(settled);
        return settled;
    }

    function closeFight() {
        const active = fight;
        const returnScreen = active?.request.returnScreen;
        // Leaving an UNSETTLED fight is a forfeit, not an escape. Without this a
        // player about to lose could close the screen and take no damage at all,
        // making every fight free to retry — strictly better than winning
        // carefully. The server scores it: an `active` session settles as a
        // forfeit and hospitalizes, exactly like a defeat.
        if (shouldSettleOnClose(!!active, settledRef.current) && active) {
            settledRef.current = true;
            void settle(active.runId, playerName).catch(() => { /* the run stays open; the seal expires */ });
        }
        setFight(null);
        onClose?.(returnScreen);
    }

    return (
        <Suspense fallback={null}>
            <MissionArenaFight
                character={character}
                runId={fight.runId}
                initialSession={fight.session}
                sharedImages={sharedImages}
                savedBloodlines={savedBloodlines}
                creatorJutsus={creatorJutsus}
                creatorItems={creatorItems}
                settleFn={settle}
                // Settle on ANY resolution, not just a win: a defeat has to reach
                // the server or it costs the player nothing.
                settleOnAnyDone
                onRecordBattle={onRecordBattle}
                recordMode={request.battleKind === "practice" ? "Practice" : "AI Fight"}
                enemyAvatarOverride={request.enemyAvatar}
                onExit={closeFight}
                renderResult={(ctx) => (
                    <AiFightResultCard
                        won={ctx.won}
                        draw={ctx.draw}
                        settleState={ctx.settleState}
                        settleResult={ctx.settleResult as AiFightSettleResult | null}
                        opponentName={opponentName}
                        onRetry={ctx.retry}
                        onExit={closeFight}
                    />
                )}
            />
        </Suspense>
    );
}

/**
 * The result card. Its own component (not inline JSX) so the outcome stamp runs in
 * an effect on mount rather than during MissionArenaFight's render — the pending
 * wanderer/ambush record must be stamped on a LOSS too, and settleFn only runs on
 * a win.
 */
function AiFightResultCard({
    won,
    draw,
    settleState,
    settleResult,
    opponentName,
    onRetry,
    onExit,
}: {
    won: boolean;
    draw: boolean;
    settleState: "idle" | "pending" | "settled" | "failed";
    settleResult: AiFightSettleResult | null;
    opponentName: string;
    onRetry: () => void;
    onExit: () => void;
}) {
    useEffect(() => { stampAiFightOutcome(won, draw); }, [won, draw]);

    if (!won) {
        return (
            <div className="story-fight-complete" role="dialog" aria-label={draw ? "Fight drawn" : "Fight lost"}>
                <div className="story-fight-complete-card">
                    <p className="story-fight-complete-kicker">{draw ? "Stalemate" : "Defeated"}</p>
                    <h2>{opponentName}</h2>
                    <p className="story-fight-complete-boss">
                        {draw
                            ? "Neither side could finish it. No reward was earned."
                            : `${opponentName} stands over you. You are carried to the hospital — no reward was earned.`}
                    </p>
                    {settleState === "failed"
                        ? <button onClick={onRetry}>Retry</button>
                        : <button disabled={settleState === "pending"} onClick={onExit}>Return</button>}
                </div>
            </div>
        );
    }

    // WIN. Reward numbers come from the server's settle response — never a local
    // prediction, because the daily soft cap and a profession payout can both
    // change what is actually granted.
    const grantedNothing = settleResult && settleResult.outcome === "win" && settleResult.ryo <= 0;
    return (
        <div className="story-fight-complete" role="dialog" aria-label="Fight won">
            <div className="story-fight-complete-card">
                <p className="story-fight-complete-kicker">Victory</p>
                <h2>{opponentName} defeated.</h2>
                {settleState !== "settled" || !settleResult
                    ? (
                        <p className="story-fight-complete-rewards">
                            {settleState === "failed" ? "The reward could not be verified." : "Tallying rewards…"}
                        </p>
                    )
                    : !settleResult.settled
                        ? <p className="story-fight-complete-rewards">No reward was granted for this fight.</p>
                        : settleResult.replayed
                            ? <p className="story-fight-complete-rewards">This reward was already collected.</p>
                            : grantedNothing
                                // A practice bout pays nothing by design — say so
                                // plainly rather than showing a bare "+0 ryo".
                                ? <p className="story-fight-complete-rewards">Practice bout — no rewards.</p>
                                : (
                                    <p className="story-fight-complete-rewards">
                                        +{settleResult.ryo} ryo{settleResult.capped ? " (daily cap reached)" : ""}
                                        <span className="story-fight-complete-title">Stat points come from training, your dailies, and serious PvP.</span>
                                    </p>
                                )}
                {settleState === "failed"
                    ? <button onClick={onRetry}>Retry</button>
                    : <button disabled={settleState === "pending"} onClick={onExit}>Continue</button>}
            </div>
        </div>
    );
}
