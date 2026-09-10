import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    canEnterTacticalArena,
    isPetAvailableForWarfront,
    petDisplayName,
} from "../lib/pet";
import { derivePetRole, ROLE_META } from "../lib/pet-roles";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { petPvpGearById, petConsumableById } from "../data/pet-config";
// Keep both battle renderers out of the ladder's initial load.
const PetWarfrontRite = lazy(() => import("../components/PetWarfrontRite").then((m) => ({ default: m.PetWarfrontRite })));
const PetShowdownReplay = lazy(() => import("../components/PetShowdownReplay").then((m) => ({ default: m.PetShowdownReplay })));
const PetLadderQueuePanel = lazy(() => import("../components/PetLadderQueuePanel").then((m) => ({ default: m.PetLadderQueuePanel })));
import { defaultWarfrontLadderPlan, parseWarfrontLadderPlan, type WarfrontLadderPlan } from "../lib/pet-ladder-setup";
import { WarfrontLadderFormation } from "../components/WarfrontLadderFormation";
import { petCardImage } from "../lib/pet-battle-anim";
import { petVisualVariantClass } from "../lib/pet-visual-variant";
import { activeCarriedPets } from "../lib/entitlements";
import { activeClientBreedingParentIds } from "../lib/pet-breeding";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import {
    type Mode, type LadderView, type OfferOpponent, type ChallengeResult, type ChallengeReplay, type PetLite,
    fetchLadder, setLadderDefense, getLadderOffer, challengeLadder, clearLadderNotify, toClientPet, toClientWarfrontSlot,
} from "../lib/pet-ladder-client";
import coliseumHero from "../assets/coliseum/coliseum-bg.webp";   // the real in-battle coliseum (matches the Coliseum duel backdrop)
import tacticalHero from "../assets/warfront-rite/warfront-rite-keyart.webp";
import arenaModeColosseum from "../assets/coliseum/arena-mode-colosseum.webp";
import arenaModeWarfront from "../assets/warfront-rite/warfront-rite-card.webp";
import { GameIcon } from "../components/icons/GameIcon";
import { GiChatBubble } from "../components/icons/LightweightGameIcons";
import "./PetLadder.css";

/*
 * Pet Ladder — global positional ranking (Sword-x-Staff style) for Pet Coliseum
 * (1v1) and Beastbound Warfront (4v4). Set a sealed defense, challenge close-above rivals
 * (offline), climb. Resolution is server-authoritative; this screen replays the
 * sealed result in the 2.5D/3D cinematic with PvP items applied.
 */

const MODE_LABEL: Record<Mode, string> = { coliseum: "Pet Colosseum", tactical: "Beastbound Warfront" };
const MODE_SUB: Record<Mode, string> = { coliseum: "1v1 duel · defend with one pet", tactical: "4v4 offline ladder · best of three clashes" };
/* Painted mode emblems shared with the Pet Arena activity tiles — the ladder
   and the arena must read as the same two destinations. */
const MODE_ART: Record<Mode, string> = { coliseum: arenaModeColosseum, tactical: arenaModeWarfront };
const HERO: Record<Mode, string> = { coliseum: coliseumHero, tactical: tacticalHero };

function gearLabel(pet: Pet): string | null {
    const g = petPvpGearById(pet.loadout?.pvp);
    const c = petConsumableById(pet.loadout?.consumable);
    const parts: string[] = [];
    if (g) parts.push(g.name);
    if (c) parts.push(c.name);
    return parts.length ? parts.join(" · ") : null;
}

const MEDAL: Record<number, { bg: string; ring: string }> = {
    1: { bg: "radial-gradient(circle at 35% 28%, #fff0b8, #e0a106 72%)", ring: "#fff3c4" },
    2: { bg: "radial-gradient(circle at 35% 28%, #f6f9fc, #97a4b5 72%)", ring: "#e8eef6" },
    3: { bg: "radial-gradient(circle at 35% 28%, #f4c794, #a35a22 72%)", ring: "#ffd9a8" },
};
function RankBadge({ rank }: { rank: number }) {
    const m = MEDAL[rank];
    if (!m) return <div className="pl-medal plain">{rank}</div>;
    return <div className="pl-medal" title={`Rank ${rank}`} style={{ background: m.bg, boxShadow: `0 0 0 2px ${m.ring}, 0 2px 8px rgba(0,0,0,.55)` }}>{rank}</div>;
}

const summaryChips = (pets: PetLite[]) => (
    <span className="pl-chips">
        {pets.map((p, i) => (
            <span key={i} className="pl-chip">
                <b style={{ color: ROLE_META[p.role ?? "tracker"]?.color }}>{p.name}</b>
                <span className="dim"> L{p.level} {p.element}</span>
            </span>
        ))}
    </span>
);

/** Parent refreshes must not restart a resolved replay's worker or playback. */
function RankedWarfrontReplay({ replay, sharedImages, onExit }: {
    replay: Extract<ChallengeReplay, { kind: "warfront" }>;
    sharedImages: Record<string, string>;
    onExit: () => void;
}) {
    const blue = useMemo<ArenaSlot[]>(() => replay.blue.map(toClientWarfrontSlot), [replay]);
    const red = useMemo<ArenaSlot[]>(() => replay.red.map(toClientWarfrontSlot), [replay]);
    const sealedReplay = useMemo(() => ({ bluePlan: replay.bluePlan, redPlan: replay.redPlan }), [replay]);
    return <Suspense fallback={<div className="pl-empty">Loading Beastbound Warfront…</div>}>
        <PetWarfrontRite blue={blue} red={red} seed={replay.seed} sharedImages={sharedImages}
            sealedReplay={sealedReplay} spectator onExit={onExit} />
    </Suspense>;
}

type PetLadderProps = { character: Character; setScreen: (s: Screen) => void; sharedImages: Record<string, string> };

/** An account change must discard the previous account's edits and replay. */
export function PetLadder(props: PetLadderProps) {
    return <PetLadderSession key={props.character.name} {...props} />;
}

function PetLadderSession({ character, setScreen, sharedImages }: PetLadderProps) {
    const carriedPets = activeCarriedPets<Pet>(character);
    const breedingPetIds = activeClientBreedingParentIds(character);
    const [mode, setMode] = useState<Mode>(() => (
        sessionStorage.getItem("petLadder.mode") === "tactical" && canEnterTacticalArena(carriedPets, breedingPetIds)
            ? "tactical"
            : "coliseum"
    ));
    const [view, setView] = useState<LadderView | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [picksEdit, setPicks] = useState<string[] | null>(null);
    const [offer, setOffer] = useState<OfferOpponent[] | null>(null);
    const [replay, setReplay] = useState<ChallengeResult | null>(null);
    const [outcome, setOutcome] = useState<{ won: boolean; rank: number | null } | null>(null);
    const [planEdit, setPlanEdit] = useState<WarfrontLadderPlan | null>(null);
    const defPlan = planEdit ?? parseWarfrontLadderPlan(view?.you?.warfrontPlan) ?? defaultWarfrontLadderPlan();
    const refreshId = useRef(0);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; refreshId.current += 1; };
    }, []);

    const name = character.name;
    const teamSize = mode === "tactical" ? 4 : 1;
    // Admin-comped entitlements can expire while this screen remains mounted.
    const available = activeCarriedPets<Pet>(character).filter((pet) => isPetAvailableForWarfront(pet, breedingPetIds));
    const tacticalUnlocked = available.length >= TACTICAL_ARENA_PET_REQUIREMENT;
    const picks = picksEdit ?? view?.you.defensePetIds ?? available.slice(0, teamSize).map((pet) => pet.id);

    const refresh = useCallback(async () => {
        const id = ++refreshId.current;
        try {
            const nextView = await fetchLadder(name, mode);
            if (id === refreshId.current) { setErr(null); setView(nextView); }
        } catch (e) {
            if (id === refreshId.current) setErr((e as Error).message);
        }
    }, [name, mode]);

    const selectMode = (nextMode: Mode) => {
        if (nextMode === "tactical" && !tacticalUnlocked) return;
        if (nextMode === mode) return;
        refreshId.current += 1;
        setView(null); setErr(null); setMode(nextMode);
        setPicks(null); setPlanEdit(null); setOffer(null); setOutcome(null);
        sessionStorage.setItem("petLadder.mode", nextMode);
    };

    useEffect(() => { void refresh(); }, [refresh]); // eslint-disable-line react-hooks/set-state-in-effect

    const togglePick = (id: string) => {
        if (teamSize === 1) { setPicks([id]); return; }
        setPicks(picks.includes(id) ? picks.filter((x) => x !== id) : picks.length >= teamSize ? picks : [...picks, id]);
    };

    const saveDefense = async () => {
        const availableIds = new Set(available.map((pet) => pet.id));
        if (picks.length !== teamSize || new Set(picks).size !== teamSize || picks.some((id) => !availableIds.has(id))) return;
        setBusy(true);
        try {
            await setLadderDefense(name, mode, picks, mode === "tactical" ? { warfrontPlan: defPlan } : undefined);
            if (!mounted.current) return;
            await refresh();
            if (mounted.current) { setPicks(null); setPlanEdit(null); }
        } catch (e) { if (mounted.current) setErr((e as Error).message); }
        finally { if (mounted.current) setBusy(false); }
    };
    const openOffer = async () => {
        setBusy(true);
        try { const next = await getLadderOffer(name, mode); if (mounted.current) setOffer(next.offer); }
        catch (e) { if (mounted.current) setErr((e as Error).message); }
        finally { if (mounted.current) setBusy(false); }
    };
    const doChallenge = async (targetId: string) => {
        setBusy(true);
        try {
            const r = await challengeLadder(name, mode, targetId);
            if (!mounted.current) return;
            setOffer(null); setReplay(r); setOutcome({ won: r.won, rank: r.rank });
        }
        catch (e) { if (mounted.current) { setErr((e as Error).message); setOffer(null); } }
        finally { if (mounted.current) setBusy(false); }
    };
    const exitCinematic = () => { setReplay(null); void refresh(); };

    // ── Cinematic replay of the sealed challenge (items applied) ───────────────
    if (replay) {
        const r = replay.replay;
        if (r.kind === "showdown") {
            // The server derived this script from the same inputs it scored the
            // challenge with, so the fight on screen IS the fight that moved the
            // rank. Played through the normal Showdown arena in spectator mode.
            return <Suspense fallback={<LoadingState />}><PetShowdownReplay script={r.script} playerPets={[toClientPet(r.player)]} sharedImages={sharedImages} onExit={exitCinematic} /></Suspense>;
        }
        if (r.kind === "coliseum" || r.kind === "tactical") {
            // A row stored before the engine cutover. Its winner came from the
            // retired sim, so re-deriving it on Showdown could contradict the
            // recorded rank — the result stands, the fight is not replayable.
            return (
                <div className="card" style={{ maxWidth: 480, margin: "2rem auto", textAlign: "center" }}>
                    <p>This challenge predates the new arena and cannot be replayed.</p>
                    <button onClick={exitCinematic}>← Back to the ladder</button>
                </div>
            );
        }
        return <RankedWarfrontReplay replay={r} sharedImages={sharedImages} onExit={exitCinematic} />;
    }

    const you = view?.you;
    const hasUnsavedDefense = !!you?.hasDefense && (
        JSON.stringify(picks) !== JSON.stringify(you.defensePetIds)
        || (mode === "tactical" && JSON.stringify(defPlan) !== JSON.stringify(parseWarfrontLadderPlan(you.warfrontPlan) ?? defaultWarfrontLadderPlan()))
    );
    const canChallenge = !!you?.hasDefense && !hasUnsavedDefense && (you?.challengesLeft ?? 0) > 0;

    return (
        <div className="pl-screen">
            <button className="pl-back" onClick={() => setScreen("arenaDistrict")}>← Arena District</button>

            {/* Hero banner */}
            <div className="pl-hero">
                <span className="pl-hero-badge">Ranked Ladder</span>
                <img src={HERO[mode]} alt="" />
                <div className="pl-hero-body">
                    <h2 className="pl-hero-title"><img className="pl-mode-art" src={MODE_ART[mode]} alt="" /> {MODE_LABEL[mode]}</h2>
                    <div className="pl-hero-sub">{MODE_SUB[mode]} · climb by beating the rival above you</div>
                </div>
            </div>

            {/* Mode tabs */}
            <div className="pl-tabs" role="group" aria-label="Pet Ladder mode">
                {(["coliseum", "tactical"] as Mode[]).map((m) => (
                    <button key={m} className={`pl-tab${mode === m ? " is-active" : ""}`}
                        aria-pressed={mode === m}
                        disabled={busy || (m === "tactical" && !tacticalUnlocked)}
                        title={m === "tactical" && !tacticalUnlocked ? `Locked: ${available.length}/${TACTICAL_ARENA_PET_REQUIREMENT} available pets` : undefined}
                        onClick={() => selectMode(m)}>
                        <img className="pl-mode-art pl-mode-art-tab" src={MODE_ART[m]} alt="" /> {MODE_LABEL[m]}
                        {m === "tactical" && !tacticalUnlocked ? ` · Locked ${available.length}/${TACTICAL_ARENA_PET_REQUIREMENT}` : ""}
                    </button>
                ))}
            </div>

            {err && <div className="pl-err">⚠ {err} <button onClick={() => void refresh()}>Retry</button></div>}

            {/* Your standing (full width) */}
            <div className="pl-panel pl-standing">
                <div className="pl-rank-big">
                    <div className="pl-rank-num">{you?.rank ? `#${you.rank}` : "—"}</div>
                    <div className="pl-rank-lbl">{you?.rank ? "Your rank" : "Unranked"}</div>
                </div>
                <div className="pl-stats">
                    <div className="pl-stat"><div className="pl-stat-n">{recordOf(view, "wins")}</div><div className="pl-stat-l">Wins</div></div>
                    <div className="pl-stat"><div className="pl-stat-n">{recordOf(view, "losses")}</div><div className="pl-stat-l">Losses</div></div>
                    <div className="pl-stat"><div className="pl-stat-n">{recordOf(view, "defended")}</div><div className="pl-stat-l">Held</div></div>
                    <div className="pl-stat"><div className="pl-stat-n">{view?.total ?? "—"}</div><div className="pl-stat-l">Ranked</div></div>
                </div>
                <div className="pl-charges">
                    <div className="pl-charges-n">{you?.challengesLeft ?? "—"}<span style={{ fontSize: 13, opacity: .6 }}>/10</span></div>
                    <div className="pl-charges-l"><GameIcon name="bolt" size={12} /> Challenges left</div>
                </div>
            </div>

            {/* Notifications */}
            {!!view?.notifications.length && (
                <div className="pl-notify">
                    <div className="pl-notify-head">
                        <b><GiChatBubble size={13} style={{ color: "var(--sj-gold)" }} /> While you were away</b>
                        <button className="pl-link" onClick={async () => { try { await clearLadderNotify(name); if (mounted.current) await refresh(); } catch { /* ignore */ } }}>Clear</button>
                    </div>
                    {view.notifications.slice().reverse().map((n, i) => (
                        <div key={i} className="pl-notify-row"><GameIcon name={n.won ? "hazard" : "shield"} size={13} style={{ color: n.won ? "var(--sj-danger)" : "var(--sj-success)" }} /> <b>{n.from}</b> {n.won ? "took your rank" : "failed to take your rank"} in {MODE_LABEL[n.mode]}.</div>
                    ))}
                </div>
            )}

            {outcome && (
                <div className={`pl-outcome ${outcome.won ? "win" : "loss"}`}>
                    {outcome.won ? "🎉 Victory!" : "💢 Defeated."} {outcome.rank ? `You're now rank #${outcome.rank}.` : "Keep climbing."}
                </div>
            )}

            {/* Live ranked matchmaking. The duel is resolved once by the server
                and replayed to both players; the asynchronous Coliseum and
                Tactical ladder modes below remain authoritative on their own. */}
            {mode === "coliseum" && (
                <Suspense fallback={<LoadingState />}><PetLadderQueuePanel character={character} sharedImages={sharedImages} /></Suspense>
            )}

            {/* Two columns: defense + challenge (left) | the ladder (right) */}
            <div className="pl-cols">
                <div>
                    {/* Set defense */}
                    <div className="pl-panel">
                        <h3 className="pl-h"><GameIcon name="shield" size={15} /> Your defense{mode === "tactical" ? " team" : ""}</h3>
                        <p className="pl-sub">
                            {mode === "tactical" ? "Pick 4 pets to defend your rank — they fight for you even while you're offline. Trained stats, roles, and formation count. Warfront uses no gear or consumables." : "Pick the pet that defends your rank while you're away. Stats and PvP gear count."}
                        </p>
                        {available.length < teamSize
                            ? <div className="pl-empty">You need {teamSize} available pet{teamSize > 1 ? "s" : ""} (none on expeditions) to set a defense.</div>
                            : <>
                                <div className="pl-pet-grid">
                                    {available.map((pet) => {
                                        const sel = picks.includes(pet.id);
                                        const order = picks.indexOf(pet.id);
                                        const { role } = pet.role ? { role: pet.role } : derivePetRole(pet);
                                        const rm = ROLE_META[role];
                                        const img = petCardImage(pet, sharedImages);
                                        const gear = mode === "coliseum" ? gearLabel(pet) : null;
                                        return (
                                            <button key={pet.id} type="button" className={`pl-pet${sel ? " sel" : ""} ${petVisualVariantClass(pet)}`} onClick={() => togglePick(pet.id)} disabled={busy} title={gear ?? petDisplayName(pet)}>
                                                {sel && teamSize > 1 && <span className="pl-pet-order">{order + 1}</span>}
                                                {sel && teamSize === 1 && <span className="pl-pet-check">✓</span>}
                                                {img ? <img className="pl-pet-img" src={img} alt="" /> : <div className="pl-pet-img" />}
                                                <div className="pl-pet-body">
                                                    <div className="pl-pet-name">{petDisplayName(pet)}</div>
                                                    {rm && <div className="pl-pet-role" style={{ color: rm.color }}>{rm.label}</div>}
                                                    <div className="pl-pet-stat">Lv {pet.level} · {pet.hp}hp · {pet.attack}atk{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}</div>
                                                    {gear && <div className="pl-pet-gear">⚙ {gear}</div>}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                {mode === "tactical" && (
                                    <WarfrontLadderFormation pets={picks.map((id) => available.find((pet) => pet.id === id))}
                                        plan={defPlan} onChange={setPlanEdit} disabled={busy} />
                                )}
                                <button className="pl-btn pl-btn-gold" style={{ marginTop: 12 }} onClick={saveDefense} disabled={busy || picks.length !== teamSize || picks.some((id) => !available.some((pet) => pet.id === id))}>
                                    {you?.hasDefense ? "Update defense" : "Set defense"} ({picks.length}/{teamSize})
                                </button>
                            </>}
                    </div>

                    {/* Challenge — TACTICAL ONLY. Coliseum rank is contested through the
                        live queue above (plan §12): a ranked pet duel is fought by two
                        present players, so the old "challenge a stored defense and watch
                        the server resolve it" path would be a second, asynchronous way to
                        move the same ladder. Tactical 4v4 still resolves server-side. */}
                    {mode === "tactical" && (
                    <div className="pl-panel">
                        <button className="pl-btn pl-btn-gold pl-cta" onClick={openOffer} disabled={busy || !canChallenge}>⚔ Challenge for rank</button>
                        {!you?.hasDefense && <p className="pl-sub" style={{ textAlign: "center", margin: "9px 0 0" }}>Set a defense first to enter the ladder.</p>}
                        {hasUnsavedDefense && <p className="pl-sub" style={{ textAlign: "center", margin: "9px 0 0" }}>Save your changed team and formation before challenging.</p>}
                        {you?.hasDefense && (you?.challengesLeft ?? 0) <= 0 && <p className="pl-sub" style={{ textAlign: "center", margin: "9px 0 0" }}>You're out of challenges today — back tomorrow.</p>}
                    </div>
                    )}
                </div>

                {/* Ladder list */}
                <div className="pl-panel">
                    <h3 className="pl-h"><GameIcon name="medal" size={15} /> The ladder{view ? ` · ${view.total} ranked` : ""}</h3>
                    {!view ? (err ? <EmptyState icon={<GameIcon name="hazard" size={28} style={{ color: "var(--sj-warning)" }} />}>The ladder could not be loaded.</EmptyState> : <LoadingState />)
                        : view.ladder.length === 0 ? <EmptyState icon={<img className="pl-empty-art" src={MODE_ART[mode]} alt="" />}>No one is ranked yet — set a defense and beat the AI to claim the first rung!</EmptyState>
                            : <div className="pl-list">
                                {view.ladder.map((e) => (
                                    <div key={e.slug} className={`pl-row${e.rank === you?.rank ? " is-you" : ""}`}>
                                        <RankBadge rank={e.rank} />
                                        <div className="pl-row-main">
                                            <div className="pl-row-name">{e.name}{e.village ? <span className="pl-row-vil"> · {e.village}</span> : null}</div>
                                            {summaryChips(e.summary)}
                                        </div>
                                        <div className="pl-row-rec">{e.record.wins}W {e.record.losses}L<br /><GameIcon name="shield" size={11} /> {e.record.defended}</div>
                                    </div>
                                ))}
                            </div>}
                </div>
            </div>

            {offer && (
                <div className="pl-modal-bg" onClick={() => { if (!busy) setOffer(null); }}>
                    <div className="pl-modal" onClick={(e) => e.stopPropagation()}>
                        <h3 className="pl-h" style={{ fontSize: 18 }}>Choose your opponent</h3>
                        <p className="pl-sub">Rivals just above your rank. Beat one to take their spot — uses 1 of your daily challenges.</p>
                        <div className="pl-offer-grid">
                            {offer.map((o) => (
                                <button key={o.id} className="pl-opp" onClick={() => doChallenge(o.id)} disabled={busy}>
                                    <div className="pl-opp-top">
                                        <span className="pl-opp-name">{o.name}</span>
                                        <span className={o.kind === "ai" ? "pl-opp-ai" : "pl-opp-rank"}>{o.kind === "ai" ? "AI" : o.rank ? `#${o.rank}` : ""}</span>
                                    </div>
                                    {o.village && <div className="pl-opp-vil">{o.village}</div>}
                                    <div style={{ marginTop: 8 }}>{summaryChips(o.summary)}</div>
                                </button>
                            ))}
                        </div>
                        <button className="pl-btn" style={{ marginTop: 14 }} disabled={busy} onClick={() => setOffer(null)}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function recordOf(view: LadderView | null, key: "wins" | "losses" | "defended" | "defeated"): number {
    if (!view || view.you.rank == null) return 0;
    if (view.you.record) return view.you.record[key];
    const me = view.ladder[view.you.rank - 1];
    return me ? me.record[key] : 0;
}
