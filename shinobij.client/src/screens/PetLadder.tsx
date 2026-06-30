import { useCallback, useEffect, useMemo, useState } from "react";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import { isPetOnExpedition, petDisplayName } from "../lib/pet";
import { derivePetRole, ROLE_META } from "../lib/pet-roles";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { petPvpGearById, petConsumableById } from "../data/pet-config";
import { PetColiseumDuel, PetArenaMatch } from "../components/PetColiseum";
import { runPetDuel } from "../lib/pet-duel-sim";
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
    const [mode, setMode] = useState<Mode>(() => (sessionStorage.getItem("petLadder.mode") === "tactical" ? "tactical" : "coliseum"));
    const [view, setView] = useState<LadderView | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [picks, setPicks] = useState<string[]>([]);
    const [offer, setOffer] = useState<OfferOpponent[] | null>(null);
    const [replay, setReplay] = useState<ChallengeResult | null>(null);
    const [outcome, setOutcome] = useState<{ won: boolean; rank: number | null } | null>(null);

    const name = character.name;
    const teamSize = mode === "tactical" ? 4 : 1;
    const available = useMemo(() => character.pets.filter((p) => !isPetOnExpedition(p)), [character.pets]);

    const refresh = useCallback(async () => {
        try { setErr(null); setView(await fetchLadder(name, mode)); } catch (e) { setErr((e as Error).message); }
    }, [name, mode]);

    useEffect(() => { void refresh(); }, [refresh]); // eslint-disable-line react-hooks/set-state-in-effect
    useEffect(() => { setPicks(available.slice(0, teamSize).map((p) => p.id)); setOffer(null); setOutcome(null); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

    const togglePick = (id: string) => {
        if (teamSize === 1) { setPicks([id]); return; }
        setPicks((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= teamSize ? cur : [...cur, id]);
    };

    const saveDefense = async () => {
        if (picks.length !== teamSize) return;
        setBusy(true);
        try { await setLadderDefense(name, mode, picks); await refresh(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
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
            const result = runPetDuel(player, enemy, r.seed, 1, 1, false, true);
            return <PetColiseumDuel playerPet={player} enemyPet={enemy} seed={r.seed} result={result} sharedImages={sharedImages} onFightAgain={exitCinematic} onExit={exitCinematic} />;
        }
        const blue: ArenaSlot[] = r.blue.map((s) => ({ pet: toClientPet(s.pet), role: s.role }));
        const red: ArenaSlot[] = r.red.map((s) => ({ pet: toClientPet(s.pet), role: s.role }));
        return <PetArenaMatch blue={blue} red={red} seed={r.seed} applyItems sharedImages={sharedImages} onExit={exitCinematic} />;
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
                        onClick={() => { setMode(m); sessionStorage.setItem("petLadder.mode", m); }}>
                        {MODE_ICON[m]} {MODE_LABEL[m]}
                    </button>
                ))}
            </div>

            {err && <div className="pl-err">⚠ {err}</div>}

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
                            </>}
                    </div>

                    {/* Challenge */}
                    <div className="pl-panel">
                        <button className="pl-btn pl-btn-gold pl-cta" onClick={openOffer} disabled={busy || !canChallenge}>⚔ Challenge for rank</button>
                        {!you?.hasDefense && <p className="pl-sub" style={{ textAlign: "center", margin: "9px 0 0" }}>Set a defense first to enter the ladder.</p>}
                        {you?.hasDefense && (you?.challengesLeft ?? 0) <= 0 && <p className="pl-sub" style={{ textAlign: "center", margin: "9px 0 0" }}>You're out of challenges today — back tomorrow.</p>}
                    </div>
                </div>

                {/* Ladder list */}
                <div className="pl-panel">
                    <h3 className="pl-h">🪜 The ladder{view ? ` · ${view.total} ranked` : ""}</h3>
                    {!view ? <LoadingState />
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
