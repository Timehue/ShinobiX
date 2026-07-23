import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import {
    TACTICAL_ARENA_PET_REQUIREMENT,
    canEnterTacticalArena,
    isPetOnExpedition,
    petDisplayName,
} from "../lib/pet";
import { derivePetRole, ROLE_META } from "../lib/pet-roles";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { petPvpGearById, petConsumableById } from "../data/pet-config";
import { PetColiseumDuel } from "../components/PetColiseum";
import { PetWarfrontMatch } from "../components/PetWarfrontMatch";
import { LADDER_FORMATIONS, LADDER_DOCTRINES, asFormation, asTeamDoctrine, type WfStance, type WfDoctrine } from "../lib/pet-ladder-setup";
import { PetLadderQueuePanel } from "../components/PetLadderQueuePanel";
import { PetDuelLiveHost } from "../components/PetDuelLiveHost";
import { runPetDuelCinematic } from "../lib/pet-duel-cinematic";
import type { ArenaSlot } from "../lib/pet-arena-sim";
import {
    type Mode, type LadderView, type OfferOpponent, type ChallengeResult, type PetLite,
    fetchLadder, setLadderDefense, getLadderOffer, challengeLadder, clearLadderNotify, toClientPet,
} from "../lib/pet-ladder-client";
import coliseumHero from "../assets/coliseum/coliseum-bg.webp";   // the real in-battle coliseum (matches the Coliseum duel backdrop)
import tacticalHero from "../assets/ladder/tactical-hero.webp";
import "./PetLadder.css";

/*
 * Pet Ladder — global positional ranking (Sword-x-Staff style) for Pet Coliseum
 * (1v1) and Pet Tactical (4v4). Set a sealed defense, challenge close-above rivals
 * (offline), climb. Resolution is server-authoritative; this screen replays the
 * sealed result in the 2.5D/3D cinematic with PvP items applied.
 */

const MODE_LABEL: Record<Mode, string> = { coliseum: "Pet Coliseum", tactical: "Pet Tactical" };
const MODE_SUB: Record<Mode, string> = { coliseum: "1v1 duel · defend with one pet", tactical: "4v4 tactical · defend with a team of four" };
const MODE_ICON: Record<Mode, string> = { coliseum: "🏆", tactical: "🛡" };
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

export function PetLadder({ character, setScreen, sharedImages }: { character: Character; setScreen: (s: Screen) => void; sharedImages: Record<string, string> }) {
    const [mode, setMode] = useState<Mode>(() => (
        sessionStorage.getItem("petLadder.mode") === "tactical" && canEnterTacticalArena(character.pets)
            ? "tactical"
            : "coliseum"
    ));
    const [view, setView] = useState<LadderView | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [picks, setPicks] = useState<string[]>([]);
    const [offer, setOffer] = useState<OfferOpponent[] | null>(null);
    const [replay, setReplay] = useState<ChallengeResult | null>(null);
    const [outcome, setOutcome] = useState<{ won: boolean; rank: number | null } | null>(null);
    // Live ranked matchmaking: the queue pairs two players and the lockstep
    // host runs the fight. `queuedAgainst` arms the auto-accept so the paired
    // player is not asked to confirm a duel they just queued for.
    const [queuedAgainst, setQueuedAgainst] = useState<string | null>(null);
    const [liveDuelActive, setLiveDuelActive] = useState(false);
    const [ladderNote, setLadderNote] = useState<string | null>(null);
    // Tactical defense is more than a team: it is the whole pre-match setup a
    // player would make if they were present. Seeded from the saved defense.
    // DERIVED from the saved defense with a local override, rather than mirrored
    // into state by an effect: there is no window where the pickers show something
    // the server does not have, and an unsaved edit still survives a refresh.
    const [stanceEdit, setStanceEdit] = useState<WfStance | null>(null);
    const [doctrineEdit, setDoctrineEdit] = useState<WfDoctrine | null>(null);
    const defStance = stanceEdit ?? asFormation(view?.you?.stance);
    const defDoctrine = doctrineEdit ?? asTeamDoctrine(view?.you?.doctrine);
    const refreshId = useRef(0);

    const name = character.name;
    const teamSize = mode === "tactical" ? 4 : 1;
    const available = useMemo(() => character.pets.filter((p) => !isPetOnExpedition(p)), [character.pets]);
    // Queue with the pet you have picked to defend your rank; falling back to the
    // first available one keeps "Find a match" usable before a defense is set.
    const ladderQueuePets = useMemo(() => {
        const picked = character.pets.find((p) => p.id === picks[0]);
        const pet = picked ?? available[0];
        return pet ? [pet] : [];
    }, [character.pets, picks, available]);
    const tacticalUnlocked = available.length >= TACTICAL_ARENA_PET_REQUIREMENT;

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
        sessionStorage.setItem("petLadder.mode", nextMode);
    };

    useEffect(() => { void refresh(); }, [refresh]); // eslint-disable-line react-hooks/set-state-in-effect
    useEffect(() => { setPicks(available.slice(0, teamSize).map((p) => p.id)); setOffer(null); setOutcome(null); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

    const togglePick = (id: string) => {
        if (teamSize === 1) { setPicks([id]); return; }
        setPicks((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= teamSize ? cur : [...cur, id]);
    };

    const saveDefense = async () => {
        if (picks.length !== teamSize) return;
        setBusy(true);
        try { await setLadderDefense(name, mode, picks, mode === "tactical" ? { stance: defStance, doctrine: defDoctrine } : undefined); await refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
    };
    const openOffer = async () => {
        setBusy(true);
        try { setOffer((await getLadderOffer(name, mode)).offer); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
    };
    const doChallenge = async (targetId: string) => {
        setBusy(true);
        try { const r = await challengeLadder(name, mode, targetId); setOffer(null); setReplay(r); setOutcome({ won: r.won, rank: r.rank }); }
        catch (e) { setErr((e as Error).message); setOffer(null); }
        finally { setBusy(false); }
    };
    const exitCinematic = () => { setReplay(null); void refresh(); };

    // ── Cinematic replay of the sealed challenge (items applied) ───────────────
    if (replay) {
        const r = replay.replay;
        if (r.kind === "coliseum") {
            const player = toClientPet(r.player), enemy = toClientPet(r.enemy);
            // Ladder replay runs the CINEMATIC engine — the server resolves via the
            // parity-tested api/_pet-sim/pet-duel-cinematic.ts mirror (scripts/gen-pet-sim.mjs),
            // so client replay and server-recorded winner stay byte-identical.
            const result = runPetDuelCinematic(player, enemy, r.seed, 1, 1, false, true);
            return <PetColiseumDuel playerPet={player} enemyPet={enemy} seed={r.seed} result={result} sharedImages={sharedImages} onExit={exitCinematic} />;
        }
        const blue: ArenaSlot[] = r.blue.map((s) => ({ pet: toClientPet(s.pet), role: s.role }));
        const red: ArenaSlot[] = r.red.map((s) => ({ pet: toClientPet(s.pet), role: s.role }));
        // The tactical ladder resolves on the WARFRONT (the lane war people play),
        // with the War Council on auto for both sides because neither player is
        // present. Replaying anything else would show a different fight.
        return <PetWarfrontMatch
            blue={blue} red={red} seed={r.seed}
            autoBuy="balanced"
            stance={r.blueStance ?? "balanced"}
            doctrine={r.blueDoctrine ?? "vanguard"}
            opponentStance={r.redStance ?? "balanced"}
            opponentDoctrine={r.redDoctrine ?? "vanguard"}
            onExit={exitCinematic}
        />;
    }

    const you = view?.you;
    const canChallenge = !!you?.hasDefense && (you?.challengesLeft ?? 0) > 0;

    return (
        <div className="pl-screen">
            <button className="pl-back" onClick={() => setScreen("petArena")}>← Arena District</button>

            {/* Hero banner */}
            <div className="pl-hero">
                <span className="pl-hero-badge">Ranked Ladder</span>
                <img src={HERO[mode]} alt="" />
                <div className="pl-hero-body">
                    <h2 className="pl-hero-title">{MODE_ICON[mode]} {MODE_LABEL[mode]}</h2>
                    <div className="pl-hero-sub">{MODE_SUB[mode]} · climb by beating the rival above you</div>
                </div>
            </div>

            {/* Mode tabs */}
            <div className="pl-tabs">
                {(["coliseum", "tactical"] as Mode[]).map((m) => (
                    <button key={m} className={`pl-tab${mode === m ? " is-active" : ""}`}
                        disabled={m === "tactical" && !tacticalUnlocked}
                        title={m === "tactical" && !tacticalUnlocked ? `Locked: ${available.length}/${TACTICAL_ARENA_PET_REQUIREMENT} available pets` : undefined}
                        onClick={() => selectMode(m)}>
                        {MODE_ICON[m]} {MODE_LABEL[m]}
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
                    <div className="pl-charges-l">⚡ Challenges left</div>
                </div>
            </div>

            {/* Notifications */}
            {!!view?.notifications.length && (
                <div className="pl-notify">
                    <div className="pl-notify-head">
                        <b>📨 While you were away</b>
                        <button className="pl-link" onClick={async () => { try { await clearLadderNotify(name); await refresh(); } catch { /* ignore */ } }}>Clear</button>
                    </div>
                    {view.notifications.slice().reverse().map((n, i) => (
                        <div key={i} className="pl-notify-row">{n.won ? "❌" : "🛡"} <b>{n.from}</b> {n.won ? "took your rank" : "failed to take your rank"} in {MODE_LABEL[n.mode]}.</div>
                    ))}
                </div>
            )}

            {outcome && (
                <div className={`pl-outcome ${outcome.won ? "win" : "loss"}`}>
                    {outcome.won ? "🎉 Victory!" : "💢 Defeated."} {outcome.rank ? `You're now rank #${outcome.rank}.` : "Keep climbing."}
                </div>
            )}

            {/* Live ranked matchmaking + the duel it produces. Coliseum only —
                tactical 4v4 is still the sealed server resolve. */}
            {mode === "coliseum" && (
                <>
                    <PetLadderQueuePanel
                        playerName={name}
                        level={character.level}
                        elo={character.petRankedRating ?? 1000}
                        pets={ladderQueuePets}
                        duelActive={liveDuelActive}
                        onMatched={(opponent) => { setQueuedAgainst(opponent); setLiveDuelActive(true); }}
                    />
                    <PetDuelLiveHost
                        myPets={ladderQueuePets}
                        autoAcceptFrom={queuedAgainst}
                        onError={(message) => { setErr(message); setQueuedAgainst(null); setLiveDuelActive(false); }}
                        onOutcome={(result, opponent) => {
                            setQueuedAgainst(null);
                            setLiveDuelActive(false);
                            setErr(null);
                            setOutcome({ won: result === "win", rank: null });
                            setLadderNote(result === "win" ? `You beat ${opponent}.` : result === "draw" ? `Draw with ${opponent}.` : `${opponent} took that one.`);
                            void refresh();
                        }}
                        sharedImages={sharedImages}
                    />
                    {ladderNote && <p className="hint" style={{ textAlign: "center" }}>{ladderNote}</p>}
                </>
            )}

            {/* Two columns: defense + challenge (left) | the ladder (right) */}
            <div className="pl-cols">
                <div>
                    {/* Set defense */}
                    <div className="pl-panel">
                        <h3 className="pl-h">🛡 Your defense{mode === "tactical" ? " team" : ""}</h3>
                        <p className="pl-sub">
                            {mode === "tactical" ? "Pick 4 pets to defend your rank — they fight for you even while you're offline." : "Pick the pet that defends your rank while you're away."} Stats &amp; PvP items count.
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
                                        const img = pet.image || sharedImages[`pet:${pet.id}`] || "";
                                        const gear = gearLabel(pet);
                                        return (
                                            <button key={pet.id} type="button" className={`pl-pet${sel ? " sel" : ""}`} onClick={() => togglePick(pet.id)} title={gear ?? petDisplayName(pet)}>
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
                                <button className="pl-btn pl-btn-gold" style={{ marginTop: 12 }} onClick={saveDefense} disabled={busy || picks.length !== teamSize}>
                                    {you?.hasDefense ? "Update defense" : "Set defense"} ({picks.length}/{teamSize})
                                </button>
                                {/* The rest of the pre-match setup. A defense fights while its
                                    owner is offline, so these are the calls they leave behind —
                                    and the War Council runs on auto, because nobody is there to
                                    answer a 30-second buy popup. */}
                                {mode === "tactical" && (
                                    <div className="pl-setup">
                                        <div className="pl-sub" style={{ marginTop: 10, fontWeight: 700 }}>Opening formation</div>
                                        <div className="menu" style={{ gap: 6, flexWrap: "wrap" }}>
                                            {LADDER_FORMATIONS.map((f) => (
                                                <button key={f.value} type="button" title={f.hint}
                                                    aria-pressed={defStance === f.value}
                                                    className={defStance === f.value ? "pl-btn pl-btn-gold" : "pl-btn"}
                                                    onClick={() => setStanceEdit(f.value)}>{f.label}</button>
                                            ))}
                                        </div>
                                        <div className="pl-sub" style={{ marginTop: 10, fontWeight: 700 }}>Team doctrine</div>
                                        <div className="menu" style={{ gap: 6, flexWrap: "wrap" }}>
                                            {LADDER_DOCTRINES.map((d) => (
                                                <button key={d.value} type="button" title={d.hint}
                                                    aria-pressed={defDoctrine === d.value}
                                                    className={defDoctrine === d.value ? "pl-btn pl-btn-gold" : "pl-btn"}
                                                    onClick={() => setDoctrineEdit(d.value)}>{d.label}</button>
                                            ))}
                                        </div>
                                        <p className="pl-sub" style={{ marginTop: 8 }}>
                                            War Council runs automatically for a defense — you will not be there to call the buys.
                                        </p>
                                    </div>
                                )}
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
                        {you?.hasDefense && (you?.challengesLeft ?? 0) <= 0 && <p className="pl-sub" style={{ textAlign: "center", margin: "9px 0 0" }}>You're out of challenges today — back tomorrow.</p>}
                    </div>
                    )}
                </div>

                {/* Ladder list */}
                <div className="pl-panel">
                    <h3 className="pl-h">🪜 The ladder{view ? ` · ${view.total} ranked` : ""}</h3>
                    {!view ? (err ? <EmptyState icon="⚠">The ladder could not be loaded.</EmptyState> : <LoadingState />)
                        : view.ladder.length === 0 ? <EmptyState icon="🪜">No one is ranked yet — set a defense and beat the AI to claim the first rung!</EmptyState>
                            : <div className="pl-list">
                                {view.ladder.map((e) => (
                                    <div key={e.slug} className={`pl-row${e.slug === character.name ? " is-you" : ""}`}>
                                        <RankBadge rank={e.rank} />
                                        <div className="pl-row-main">
                                            <div className="pl-row-name">{e.name}{e.village ? <span className="pl-row-vil"> · {e.village}</span> : null}</div>
                                            {summaryChips(e.summary)}
                                        </div>
                                        <div className="pl-row-rec">{e.record.wins}W {e.record.losses}L<br />🛡 {e.record.defended}</div>
                                    </div>
                                ))}
                            </div>}
                </div>
            </div>

            {offer && (
                <div className="pl-modal-bg" onClick={() => setOffer(null)}>
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
                        <button className="pl-btn" style={{ marginTop: 14 }} onClick={() => setOffer(null)}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
}

function recordOf(view: LadderView | null, key: "wins" | "losses" | "defended" | "defeated"): number {
    if (!view || view.you.rank == null) return 0;
    const me = view.ladder[view.you.rank - 1];
    return me ? me.record[key] : 0;
}
