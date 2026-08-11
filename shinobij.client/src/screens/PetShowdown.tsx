/*
 * PetShowdown — the flagship pet battle mode's host screen.
 *
 * Lobby (format + difficulty tier + team picker) → server-minted session
 * (/api/pet/showdown, engine lives server-side only) → fullscreen cinematic
 * playback via PetShowdownBattle. Ryo is client-owned: the finishing turn's
 * response carries the settled character snapshot, which this screen ADOPTS via
 * updateCharacter (the same pattern as /api/pet/battle-result callers).
 *
 * The two lifted battle signals are deliberately separate (project rule):
 * onFullscreenActiveChange drives chrome hiding only; onBattleActiveChange
 * drives the nav lock/presence and clears the moment the outcome is decided.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameIcon, type GameIconName } from "../components/icons/GameIcon";
import "./PetShowdown.css";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import type { Screen } from "../types/core";
import { isPetOnExpedition } from "../lib/pet";
import { petCardImage } from "../lib/pet-battle-anim";
import { petPvpGearById } from "../data/pet-config";
import { preloadPetColiseumModels } from "../lib/pet-model-preload";
import {
    startShowdown,
    submitShowdownTurn,
    forfeitShowdown,
    fetchShowdownState,
    type ShowdownCommand,
    type ShowdownFormat,
    type ShowdownStateView,
    type ShowdownTier,
    type ShowdownTurnResponse,
} from "../lib/pet-showdown-api";
import { PetShowdownBattle } from "../components/PetShowdownBattle";

// Refresh-resume breadcrumb: the server session outlives the tab (45-min KV
// TTL), so a reload mid-battle can pick the fight back up via action:"state".
const SESSION_BREADCRUMB_KEY = "showdown.session.v1";

function readSessionBreadcrumb(): { sessionId: string; petIds: string[] } | null {
    try {
        const raw = sessionStorage.getItem(SESSION_BREADCRUMB_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { sessionId?: unknown; petIds?: unknown };
        if (typeof parsed.sessionId !== "string" || !Array.isArray(parsed.petIds)) return null;
        return { sessionId: parsed.sessionId, petIds: parsed.petIds.map(String) };
    } catch {
        return null;
    }
}

function writeSessionBreadcrumb(value: { sessionId: string; petIds: string[] } | null): void {
    try {
        if (value) sessionStorage.setItem(SESSION_BREADCRUMB_KEY, JSON.stringify(value));
        else sessionStorage.removeItem(SESSION_BREADCRUMB_KEY);
    } catch { /* storage disabled — resume simply won't survive a refresh */ }
}

const MAX_TEAM = 3;

const FORMATS: { id: ShowdownFormat; label: string; size: number; blurb: string }[] = [
    { id: "1v1", label: "1v1 Duel", size: 1, blurb: "One on the field, two in reserve — the switching mind game." },
    { id: "2v2", label: "2v2 Showdown", size: 2, blurb: "The flagship — synergy, focus fire, a bench pivot." },
    { id: "3v3", label: "3v3 Rumble", size: 3, blurb: "Full squad warfare, no reserves." },
];

// GameIcon is already on the entry path (MobileNav), so reusing it from this
// lazy screen costs nothing new — and it keeps the lobby in the same drawn
// language as the battle HUD instead of three OS emoji.
const TIERS: { id: ShowdownTier; label: string; icon: GameIconName; blurb: string }[] = [
    { id: "scrapper", label: "Scrapper", icon: "paw", blurb: "Street strays. Learn the ropes." },
    { id: "warrior", label: "Warrior", icon: "sword", blurb: "Hardened kennels. A fair fight." },
    { id: "champion", label: "Champion", icon: "medal", blurb: "Apex beasts. Bring your best." },
];

export function PetShowdown({ character, updateCharacter, setScreen, sharedImages, onBattleActiveChange, onFullscreenActiveChange }: {
    character: Character;
    updateCharacter: (next: Character) => void;
    setScreen: (screen: Screen) => void;
    sharedImages: Record<string, string>;
    onBattleActiveChange?: (active: boolean) => void;
    onFullscreenActiveChange?: (active: boolean) => void;
}) {
    // Default to a format the roster can actually FIELD. The starter grants
    // exactly one pet, so an unconditional "2v2" default meant a brand-new
    // player's first frame of the flagship mode was a gold button that did
    // nothing when pressed, with nothing on screen saying why.
    const [format, setFormat] = useState<ShowdownFormat>(() => {
        const ready = (character.pets ?? []).length;
        return ready >= 2 ? "2v2" : "1v1";
    });
    const [tier, setTier] = useState<ShowdownTier>("scrapper");
    const [selected, setSelected] = useState<string[]>([]);
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [battle, setBattle] = useState<{ state: ShowdownStateView; key: number } | null>(null);
    const battleKey = useRef(1);

    const size = FORMATS.find((f) => f.id === format)?.size ?? 2;
    const pets = useMemo(() => character.pets ?? [], [character.pets]);

    const busyReason = useCallback((pet: Pet): string | null => {
        if (isPetOnExpedition(pet)) return "On expedition";
        if (pet.training && Date.now() < pet.training.endsAt) return "Training";
        if (pet.breedingSessionId) return "Breeding barn";
        return null;
    }, []);

    /** Pets that are not away training/expeditioning — what the roster can field. */
    const available = useMemo(() => pets.filter((p) => !busyReason(p)), [pets, busyReason]);

    const selectedPets = useMemo(
        () => selected.map((id) => pets.find((p) => p.id === id)).filter(Boolean) as Pet[],
        [selected, pets],
    );

    // Warm the GLB + atlas caches while the player is still picking.
    useEffect(() => {
        if (selectedPets.length) preloadPetColiseumModels(selectedPets);
    }, [selectedPets]);

    // Lifted-signal lifecycle: fullscreen while the battle overlay is mounted;
    // "unresolved battle" only until the outcome lands (or the player concedes).
    const setSignals = useCallback((fullscreen: boolean, unresolved: boolean) => {
        onFullscreenActiveChange?.(fullscreen);
        onBattleActiveChange?.(unresolved);
    }, [onFullscreenActiveChange, onBattleActiveChange]);
    useEffect(() => () => setSignals(false, false), [setSignals]);

    // Refresh-resume: an unresolved server session picks the fight back up.
    useEffect(() => {
        const crumb = readSessionBreadcrumb();
        if (!crumb) return;
        let cancelled = false;
        void (async () => {
            const state = await fetchShowdownState(character.name, crumb.sessionId);
            if (cancelled) return;
            if (state && !state.finished) {
                setSelected(crumb.petIds);
                setBattle({ state, key: battleKey.current++ });
                setSignals(true, true);
            } else {
                writeSessionBreadcrumb(null);
            }
        })();
        return () => { cancelled = true; };
        // Mount-only: the breadcrumb is a one-shot restore.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const togglePet = (pet: Pet) => {
        if (busyReason(pet)) return;
        setError(null);
        setSelected((ids) => ids.includes(pet.id)
            ? ids.filter((id) => id !== pet.id)
            : ids.length < MAX_TEAM ? [...ids, pet.id] : ids);
    };

    const launch = useCallback(async () => {
        if (starting || selected.length < size) return;
        setStarting(true);
        setError(null);
        const result = await startShowdown(character.name, format, tier, selected);
        setStarting(false);
        if ("error" in result) {
            setError(result.error);
            return;
        }
        setBattle({ state: result.state, key: battleKey.current++ });
        writeSessionBreadcrumb({ sessionId: result.state.sessionId, petIds: selected });
        setSignals(true, true);
    }, [starting, selected, size, character.name, format, tier, setSignals]);

    const activeSession = battle?.state.sessionId ?? null;

    const handleSubmitTurn = useCallback(async (commands: ShowdownCommand[]) => {
        if (!activeSession) return null;
        return submitShowdownTurn(character.name, activeSession, commands);
    }, [character.name, activeSession]);

    const handleFinished = useCallback((outcome: "win" | "loss", settlement: ShowdownTurnResponse | null) => {
        // Decided: release the nav lock; the fullscreen result panel stays up.
        setSignals(true, false);
        writeSessionBreadcrumb(null);
        void outcome;
        const settledCharacter = settlement?.character as Character | undefined;
        if (settledCharacter && typeof settledCharacter === "object") {
            updateCharacter(settledCharacter);
        }
    }, [setSignals, updateCharacter]);

    const handleForfeit = useCallback(() => {
        if (activeSession) void forfeitShowdown(character.name, activeSession);
        writeSessionBreadcrumb(null);
        setBattle(null);
        setSignals(false, false);
    }, [activeSession, character.name, setSignals]);

    const handleExit = useCallback(() => {
        writeSessionBreadcrumb(null);
        setBattle(null);
        setSignals(false, false);
    }, [setSignals]);

    const handleRematch = useCallback(() => {
        setBattle(null);
        setSignals(false, false);
        void launch();
    }, [launch, setSignals]);

    return (
        <div className="showdown-screen">
            <div className="showdown-header">
                <button type="button" className="showdown-chip" onClick={() => setScreen("petArena")}>← Pet Arena</button>
                <h1>Pet Showdown</h1>
                <p className="showdown-tagline">Command your companions in cinematic turn-based battle. Read the elements, ride the stamina, land the perfect strike — and finish with a signature.</p>
            </div>

            <div className="showdown-config">
                <div className="showdown-config-block">
                    <h3>Format</h3>
                    <div className="showdown-choice-row">
                        {FORMATS.map((f) => (
                            <button
                                key={f.id}
                                type="button"
                                className={`showdown-choice ${format === f.id ? "active" : ""}`}
                                onClick={() => {
                                    setFormat(f.id);
                                    // Trim the pick to the new team size right here
                                    // (handler, not an effect) so it never overflows.
                                    setSelected((ids) => ids.slice(0, f.size));
                                }}
                            >
                                <span className="showdown-choice-label">{f.label}</span>
                                <span className="showdown-choice-blurb">{f.blurb}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="showdown-config-block">
                    <h3>Opposition</h3>
                    <div className="showdown-choice-row">
                        {TIERS.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                className={`showdown-choice ${tier === t.id ? "active" : ""}`}
                                onClick={() => setTier(t.id)}
                            >
                                <span className="showdown-choice-label"><GameIcon name={t.icon} size={15} /> {t.label}</span>
                                <span className="showdown-choice-blurb">{t.blurb}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* The rules the battle never gets a chance to teach — especially
                the judge, which decides real fights and is never stated in the
                battle UI. */}
            <details className="showdown-rules">
                <summary>How a Showdown works</summary>
                <ul>
                    <li><b>Elements</b> — Fire &gt; Wind &gt; Lightning &gt; Earth &gt; Water &gt; Fire.
                        Attacking the element you beat deals <b>×1.5</b>; attacking the one that
                        beats you deals <b>×0.75</b>.</li>
                    <li><b>Stamina</b> — a technique's cost tracks its power, and stamina comes
                        back slowly. Every kit is a ladder: a <b>jab</b> you can throw all day,
                        <b> techniques</b> in the middle, and one <b>haymaker</b> worth about half
                        the pool. The jab and the mid tier trade at the same rate, so the haymaker
                        is not the efficient pick — you are paying for it to land <em>now</em>.</li>
                    <li><b>Overdraft</b> — you may cast a move you cannot afford: it still fires,
                        but the pet <b>bleeds HP</b> for the shortfall and <b>loses its next
                        action</b>.</li>
                    <li><b>Hold</b> — the heaviest techniques and signatures need a round or two in
                        battle before they come online.</li>
                    <li><b>Turn order</b> — speed × the priority of the move you picked. Guard
                        resolves early; haymakers and signatures swing last.</li>
                    <li><b>Signature</b> — the meter fills as you deal and take damage, and it
                        empties in one cast.</li>
                    <li><b>No draws</b> — if the round limit is reached, the judge awards it to
                        the team with more remaining HP, and <b>a tie goes to your opponent</b>.</li>
                </ul>
            </details>

            <div className="showdown-roster-block">
                <h3>
                    Your team — pick {size}{MAX_TEAM > size ? ` (plus up to ${MAX_TEAM - size} bench)` : ""}
                    {selected.length ? ` · ${selected.length}/${MAX_TEAM}` : ""}
                </h3>
                {pets.length === 0 && (
                    <p className="showdown-empty">You have no companions yet. Befriend a wild pet out in the world first!</p>
                )}
                <div className="showdown-roster">
                    {pets.map((pet) => {
                        const busy = busyReason(pet);
                        const order = selected.indexOf(pet.id);
                        return (
                            <button
                                key={pet.id}
                                type="button"
                                disabled={!!busy}
                                className={`showdown-roster-card ${order >= 0 ? "picked" : ""} ${busy ? "busy" : ""}`}
                                onClick={() => togglePet(pet)}
                            >
                                {order >= 0 && (
                                    <span className="showdown-roster-order">
                                        {order < size ? order + 1 : "B"}
                                    </span>
                                )}
                                <img src={petCardImage(pet, sharedImages)} alt="" loading="lazy" />
                                <span className="showdown-roster-name">{pet.nickname || pet.name}</span>
                                <span className="showdown-roster-sub">Lv {pet.level}{pet.element && pet.element !== "None" ? ` · ${pet.element}` : ""}</span>
                                {/* Team-building happens HERE, so the trait and
                                    gear that decide a fight belong on the picker. */}
                                {(pet.trait || pet.loadout?.pvp) && (
                                    <span className="showdown-roster-kit">
                                        {pet.trait && <em title="Trait">{pet.trait}</em>}
                                        {petPvpGearById(pet.loadout?.pvp) && (
                                            <em className="gear" title={petPvpGearById(pet.loadout?.pvp)?.desc}>
                                                {petPvpGearById(pet.loadout?.pvp)?.name}
                                            </em>
                                        )}
                                    </span>
                                )}
                                {busy && <span className="showdown-roster-busy">{busy}</span>}
                            </button>
                        );
                    })}
                </div>
            </div>

            {error && <div className="showdown-error">{error}</div>}

            <div className="showdown-launch">
                <button
                    type="button"
                    className="showdown-cta"
                    disabled={selected.length < size || starting}
                    onClick={() => void launch()}
                >
                    {starting ? "Summoning your opponents…" : `Enter the ${format} Showdown`}
                </button>
                {/* A disabled CTA must always say what would enable it. */}
                {!starting && selected.length < size && (
                    <p className="showdown-launch-hint">
                        {available.length < size
                            ? <>You need {size} ready {size === 1 ? "companion" : "companions"} for {format}
                                {available.length > 0 && FORMATS.some((f) => f.size <= available.length) && (
                                    <> — <button
                                        type="button"
                                        className="showdown-linkish"
                                        onClick={() => setFormat(FORMATS.filter((f) => f.size <= available.length).slice(-1)[0].id)}
                                    >switch to {FORMATS.filter((f) => f.size <= available.length).slice(-1)[0].label}</button></>
                                )}.</>
                            : <>Pick {size - selected.length} more from your roster to begin.</>}
                    </p>
                )}
            </div>

            {battle && (
                <PetShowdownBattle
                    key={battle.key}
                    initialState={battle.state}
                    playerPets={selectedPets}
                    sharedImages={sharedImages}
                    submitTurn={handleSubmitTurn}
                    onForfeit={handleForfeit}
                    onFinished={handleFinished}
                    onExit={handleExit}
                    onRematch={handleRematch}
                />
            )}
        </div>
    );
}
