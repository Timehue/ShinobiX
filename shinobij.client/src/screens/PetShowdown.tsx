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
import { colosseumPetBusyReason, isPetAvailableForColosseum } from "../lib/pet";
import { activeCarriedPetIds } from "../lib/entitlements";
import { petCardImage } from "../lib/pet-battle-anim";
import { petPvpGearById } from "../data/pet-config";
import { clearPetColosseumPetHint, readPetColosseumPetHint } from "../lib/pet-arena-navigation";
import { activeClientBreedingParentIds } from "../lib/pet-breeding";
import { preloadPetColiseumModels, warmShowdownModels } from "../lib/pet-model-preload";
import {
    startShowdown,
    submitShowdownTurn,
    forfeitShowdown,
    fetchShowdownState,
    SHOWDOWN_BENCH_SIZE,
    SHOWDOWN_FORMAT_SIZE,
    showdownTeamSize,
    startArenaBout,
    type ShowdownCommand,
    type ShowdownFormat,
    type ShowdownOpposition,
    type ShowdownStateView,
    type ShowdownTurnResponse,
} from "../lib/pet-showdown-api";
import { PetShowdownBattle } from "../components/PetShowdownBattle";

/*
 * Refresh-resume breadcrumb: the server session outlives the tab (45-min KV
 * TTL), so a reload mid-battle picks the fight back up via action:"state".
 *
 * It lives in localStorage, alongside every other resume pointer in the client
 * (`arena.battle.v3.*`, `shinobix:towerRunId`, `storyBoss.battle.v1.*`).
 * sessionStorage dies with the tab, which is precisely the case the breadcrumb
 * exists for — a crash or a closed tab left a live server fight with nothing
 * pointing at it. The stamp bounds the crumb to the session's own TTL and the
 * name binds it to one account, so a shared device never inherits a pointer.
 */
const SESSION_BREADCRUMB_KEY = "showdown.session.v1";
// Mirrors SESSION_TTL_SECONDS in api/pet/showdown.ts: past it the session is
// gone from KV and the crumb is noise.
const SESSION_BREADCRUMB_TTL_MS = 45 * 60 * 1000;

type SessionBreadcrumb = { sessionId: string; petIds: string[]; playerName: string };

function readSessionBreadcrumb(playerName: string): SessionBreadcrumb | null {
    try {
        const raw = localStorage.getItem(SESSION_BREADCRUMB_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { sessionId?: unknown; petIds?: unknown; playerName?: unknown; savedAt?: unknown };
        if (typeof parsed.sessionId !== "string" || !Array.isArray(parsed.petIds)) return null;
        if (parsed.playerName !== playerName) return null;
        if (Date.now() - (Number(parsed.savedAt) || 0) > SESSION_BREADCRUMB_TTL_MS) return null;
        return { sessionId: parsed.sessionId, petIds: parsed.petIds.map(String), playerName };
    } catch {
        return null;
    }
}

function writeSessionBreadcrumb(value: SessionBreadcrumb | null): void {
    try {
        if (value) localStorage.setItem(SESSION_BREADCRUMB_KEY, JSON.stringify({ ...value, savedAt: Date.now() }));
        else localStorage.removeItem(SESSION_BREADCRUMB_KEY);
    } catch { /* storage disabled — resume simply won't survive a refresh */ }
}

// Field and bench sizes come from the shared contract — the server validates
// against the same numbers, so the picker can never offer a team the start
// endpoint will reject. Every format carries the same bench.
const FORMATS: { id: ShowdownFormat; label: string; size: number; blurb: string }[] = [
    { id: "1v1", label: "1v1 Duel", size: SHOWDOWN_FORMAT_SIZE["1v1"], blurb: "One on the field, two in reserve — the switching mind game." },
    { id: "2v2", label: "2v2 Showdown", size: SHOWDOWN_FORMAT_SIZE["2v2"], blurb: "The flagship — synergy, focus fire, and two reserves to pivot through." },
    { id: "3v3", label: "3v3 Rumble", size: SHOWDOWN_FORMAT_SIZE["3v3"], blurb: "Full squad warfare, with two held back." },
];

// GameIcon is already on the entry path (MobileNav), so reusing it from this
// lazy screen costs nothing new — and it keeps the lobby in the same drawn
// language as the battle HUD instead of three OS emoji.
//
// SPARRING leads, and is the default, because it is the answer to the question
// a player actually arrives with: give me a fight worth practising against, now.
// The three tiers below it are the deliberate choice — a specific rarity band,
// held level after level — and they stay for the player drilling one matchup.
const TIERS: { id: ShowdownOpposition; label: string; icon: GameIconName; blurb: string }[] = [
    { id: "sparring", label: "Sparring", icon: "dice", blurb: "The arena draws a random team, levelled to match your own pets." },
    { id: "scrapper", label: "Scrapper", icon: "paw", blurb: "Street strays. Learn the ropes." },
    { id: "warrior", label: "Warrior", icon: "sword", blurb: "Hardened kennels. A fair fight." },
    { id: "champion", label: "Champion", icon: "medal", blurb: "Apex beasts. Bring your best." },
];

export function PetShowdown({ character, updateCharacter, setScreen, sharedImages, onBattleActiveChange, onFullscreenActiveChange, bout = "practice" }: {
    character: Character;
    /** Which kind of bout this screen opens.
     *
     *  "practice" — you pick the tier and fight without limit. Pays nothing.
     *  "arena"    — the Coliseum's reward loop: the ARENA matches you, the
     *               daily win cap applies, and a win pays. No tier picker,
     *               because a chosen tier on a paying path is a difficulty
     *               slider bolted to a faucet (the server derives it and would
     *               ignore one anyway). */
    bout?: "practice" | "arena";
    updateCharacter: (next: Character) => void;
    setScreen: (screen: Screen) => void;
    sharedImages: Record<string, string>;
    onBattleActiveChange?: (active: boolean) => void;
    onFullscreenActiveChange?: (active: boolean) => void;
}) {
    const breedingPetIds = useMemo(() => activeClientBreedingParentIds(character), [character]);
    const carriedPetIds = useMemo(() => new Set(activeCarriedPetIds(character)), [character]);
    // Default to a format the roster can actually FIELD. The starter grants
    // exactly one pet, so an unconditional "2v2" default meant a brand-new
    // player's first frame of the flagship mode was a gold button that did
    // nothing when pressed, with nothing on screen saying why.
    const [format, setFormat] = useState<ShowdownFormat>(() => {
        const ready = (character.pets ?? []).filter((pet) => (
            carriedPetIds.has(pet.id) && isPetAvailableForColosseum(pet, breedingPetIds)
        )).length;
        return ready >= 2 ? "2v2" : "1v1";
    });
    const [tier, setTier] = useState<ShowdownOpposition>("sparring");
    const [selected, setSelected] = useState<string[]>(() => {
        if (bout !== "arena") return [];
        const hintedPetId = readPetColosseumPetHint();
        const hintedPet = character.pets.find((pet) => pet.id === hintedPetId);
        if (!hintedPet
            || !carriedPetIds.has(hintedPet.id)
            || !isPetAvailableForColosseum(hintedPet, breedingPetIds)) return [];
        return [hintedPet.id];
    });
    useEffect(() => {
        if (bout === "arena") clearPetColosseumPetHint();
    }, [bout]);
    /* Two beats, because the wait now has two causes and they fail differently:
     * "matching" is the server picking your opposition, "taking-the-field" is
     * their models loading. A single spinner across both makes the second look
     * like the first has hung. */
    const [starting, setStarting] = useState<false | "matching" | "fielding">(false);
    const [error, setError] = useState<string | null>(null);
    const [battle, setBattle] = useState<{ state: ShowdownStateView; key: number } | null>(null);
    const battleKey = useRef(1);

    const size = FORMATS.find((f) => f.id === format)?.size ?? 2;
    const maxTeam = showdownTeamSize(format);
    const pets = useMemo(() => character.pets ?? [], [character.pets]);

    const busyReason = useCallback((pet: Pet): string | null => {
        if (!carriedPetIds.has(pet.id)) return "Resting in Sanctuary";
        switch (colosseumPetBusyReason(pet, breedingPetIds)) {
            case "expedition": return "On expedition";
            case "training": return "Training";
            case "breeding": return "Breeding barn";
            default: return null;
        }
    }, [breedingPetIds, carriedPetIds]);

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
    //
    // A FINISHED session is not resumed but CLAIMED. It is where a win whose
    // settling response was lost to the network sits — the server already
    // resolved and paid it, and only the client is missing the settled
    // character. Re-posting an empty round re-reads that settlement (the
    // receipt in api/pet/showdown.ts makes the payout exactly-once, and a
    // practice session answers from memory without touching the save). The
    // crumb is dropped on the same pass, so a decided session is only ever
    // claimed once and never outlives its own TTL.
    useEffect(() => {
        const crumb = readSessionBreadcrumb(character.name);
        if (!crumb) return;
        let cancelled = false;
        void (async () => {
            const state = await fetchShowdownState(character.name, crumb.sessionId);
            if (cancelled) return;
            if (state && !state.finished) {
                // A resumed fight mounts just as directly as a fresh one, so it
                // needs the same warm-up — after a reload nothing is cached.
                // The full roster here, not the picked team: `selected` is
                // restored from the crumb on the line below, so there is no
                // team yet. A superset resolves the same pets by id.
                await warmShowdownModels(state, pets);
                if (cancelled) return;
                setSelected(crumb.petIds);
                setBattle({ state, key: battleKey.current++ });
                setSignals(true, true);
                return;
            }
            writeSessionBreadcrumb(null);
            if (!state || state.outcome !== "win") return;
            const settlement = await submitShowdownTurn(character.name, crumb.sessionId, []);
            if (cancelled || !settlement || "expired" in settlement) return;
            const settled = settlement.character as Character | undefined;
            if (settled && typeof settled === "object") updateCharacter(settled);
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
            : ids.length < maxTeam ? [...ids, pet.id] : ids);
    };

    const launch = useCallback(async () => {
        if (starting || selected.length < size) return;
        setStarting("matching");
        setError(null);
        const result = bout === "arena"
            ? await startArenaBout(character.name, format, selected)
            : await startShowdown(character.name, format, tier, selected);
        if ("error" in result) {
            setStarting(false);
            setError(result.error);
            return;
        }
        // The opponent is only known now, so its models can only be warmed now.
        // Hold the lobby rather than mount into a fight whose other side has no
        // body yet — the CTA names this beat, so the wait is legible.
        setStarting("fielding");
        // `selectedPets` is exactly what the battle below receives, so the
        // warm-up and the renderer resolve identical art.
        await warmShowdownModels(result.state, selectedPets);
        setStarting(false);
        setBattle({ state: result.state, key: battleKey.current++ });
        writeSessionBreadcrumb({ sessionId: result.state.sessionId, petIds: selected, playerName: character.name });
        setSignals(true, true);
    }, [starting, selected, size, character.name, format, tier, bout, selectedPets, setSignals]);

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
                {/* Name the door the player walked through. Both bouts are the
                    same engine, but arriving at a screen headed "Pet Showdown"
                    after pressing "Training Grounds" reads as having landed
                    somewhere else. */}
                <h1>{bout === "arena" ? "The Colosseum" : "Training Grounds"}</h1>
                <p className="showdown-tagline">{bout === "arena"
                    ? "The arena has your challenger. Read the elements, ride the stamina, land the perfect strike — and finish with a signature."
                    : "Spar as long as you like. Read the elements, ride the stamina, land the perfect strike — and finish with a signature. Nothing here is paid or capped."}</p>
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
                {/* The tier picker is PRACTICE-only. On the paying path the arena
                    matches you — the server derives the tier from the team you
                    bring and ignores anything sent — so offering the control
                    here would promise a choice that does not exist. */}
                {bout === "practice" && <div className="showdown-config-block">
                    <h3>Opposition</h3>
                    <div className="showdown-choice-row">
                        {TIERS.map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                className={`showdown-choice ${t.id === "sparring" ? "featured" : ""} ${tier === t.id ? "active" : ""}`}
                                onClick={() => setTier(t.id)}
                            >
                                <span className="showdown-choice-label"><GameIcon name={t.icon} size={15} /> {t.label}</span>
                                <span className="showdown-choice-blurb">{t.blurb}</span>
                            </button>
                        ))}
                    </div>
                    {/* Say what a level-matched draw actually means, because the
                        roster it matches is right below and the player can see
                        the numbers being promised. */}
                    {tier === "sparring" && (
                        <p className="showdown-choice-note">
                            Each opponent is rolled fresh and stood at the level of the pet it faces — one for one,
                            across the {SHOWDOWN_FORMAT_SIZE[format]} on the field and the bench behind them. Nothing is paid and nothing is capped.
                        </p>
                    )}
                </div>}
            </div>

            {/* The rules the battle never gets a chance to teach — especially
                attrition, which closes long fights and is never stated in the
                battle UI until its banner is already up. */}
            <details className="showdown-rules">
                <summary>How a Showdown works</summary>
                <ul>
                    <li><b>Elements</b> — Fire &gt; Wind &gt; Lightning &gt; Earth &gt; Water &gt; Fire.
                        Attacking the element you beat deals <b>×1.5</b>; attacking the one that
                        beats you deals <b>×0.75</b>. Your own-element techniques carry a
                        <b> same-type bonus</b>; the neutral Swift Strike skips the wheel both
                        ways — the safe jab into a bad matchup.</li>
                    <li><b>Physical &amp; Special</b> — contact techniques roll Attack against
                        Defense; elemental casts roll the pet's Special side, which follows its
                        role. <b>Synergy</b>: elemental techniques name a partner element, and a
                        fielded ally of it empowers the cast.</li>
                    <li><b>Conditions</b> — a pet holds two at a time; a third pushes the oldest
                        off. Fire thaws freeze, frost smothers burn. Shields sit outside the
                        limit.</li>
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
                    <li><b>25 rounds, then the judges</b> — most fights end well before. From
                        round 14 <b>attrition</b> bleeds both sides and healing fades; a fight
                        still standing after round 25 goes to the ladder: pets left, total
                        health, total stamina, then the speed arrow.</li>
                </ul>
            </details>

            <div className="showdown-roster-block">
                <h3>
                    Your team — pick {size} (plus up to {SHOWDOWN_BENCH_SIZE} bench)
                    {selected.length ? ` · ${selected.length}/${maxTeam}` : ""}
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
                    disabled={selected.length < size || starting !== false}
                    onClick={() => void launch()}
                >
                    {starting === "matching" ? "Summoning your opponents…"
                        : starting === "fielding" ? "Taking the field…"
                            : `Enter the ${format} Showdown`}
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
