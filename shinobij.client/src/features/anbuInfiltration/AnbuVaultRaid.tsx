/*
 * AnbuVaultRaid — the Anbu Vault Infiltration screen (docs/anbu-infiltration-plan.md).
 *
 * Three phases in one self-contained feature module:
 *   1. traverse — a lean navigable war-vault interior. REUSES the Hollow Gate
 *      dungeon PRIMITIVES (generateHollowGateFloor / findHollowGatePath /
 *      computeHollowGateVisible — all pure) but deliberately NOT the Hollow Gate
 *      screen, run state, shards, torch, or warden counters: separate modes that
 *      share only stateless map code. Every room is stamped with the 'warvault'
 *      theme so the renderer look comes from the generated
 *      shrine:icon-theme-warvault-* tiles; HG's pickRoomTheme can never roll that
 *      theme (it is not in HOLLOW_GATE_THEMES).
 *   2. fight — reaching the vault starts the server-auth run
 *      (api/village/anbu-infiltration action:'start') and REUSES the whole
 *      BattleTowerFight screen with actionFn/settleFn overrides (the Clan Boss
 *      pattern). The defender is the server-sealed Anbu snapshot.
 *   3. result — the raid report: which pools the server rolled, caches minted
 *      (also mirrored onto the local save via updateCharacter so the inventory
 *      shows them before the next server pull), ryo, or a clean "the Anbu held".
 *
 * The traversal is CLIENT-side flavor: rewards flow ONLY from the server-settled
 * fight win, so skipping the walk cheats nothing (docs plan §9).
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { buildVaultInterior } from "./vault-interior";
import { findHollowGatePath } from "../../lib/hollow-gate-path";
import { computeHollowGateVisible } from "../../lib/hollow-gate-dungeon";
import {
    startInfiltration,
    infiltrationAct,
    reportInfiltration,
    fetchInfiltrationState,
    anbuAvatarForVillage,
    anbuDisplayName,
    INFIL_CACHE_ITEM_IDS,
    type InfilReportResponse,
} from "../../lib/anbu-infiltration-api";
import { BattleTowerFight } from "../../screens/BattleTowerFight";
import { getAllItems } from "../../lib/items";
import { getBloodlineMultiplier } from "../../lib/combat-math";
import { getPvpItemLoadout, getCharacterArmorFactor, getCharacterArmorRawDR, getEquippedItemBonus } from "../../lib/equipment-stats";
import type { TowerSession, TowerHostLoadout } from "../../lib/towers-api";
import type { GameItem, SavedBloodline } from "../../types/combat";
import type { BattleHistoryEntry, Character, HollowGateShrineRun } from "../../types/character";

const STEP_MS = 170;
const TILE = typeof window !== "undefined" && window.innerWidth <= 480 ? 40 : 48;
// Refresh-resume: the live runId persists here while a fight is up, so a
// mid-fight reload can rejoin the server run (the BattleTowers TOWER_RUN_KEY
// pattern). Cleared on clean exits and on resolution.
const INFIL_RUN_KEY = "anbuInfiltration.activeRun";

type Phase = "traverse" | "fight" | "result";

export function AnbuVaultRaid({
    character,
    sharedImages,
    sector,
    targetVillage,
    creatorItems,
    savedBloodlines,
    updateCharacter,
    onRecordBattle,
    onExit,
}: {
    character: Character;
    sharedImages: Record<string, string>;
    sector: number;
    targetVillage: string;
    /** admin custom items + the player's bloodlines — the raider-loadout inputs
     *  (WorldMap already holds both, so App.tsx stays untouched) */
    creatorItems: GameItem[];
    savedBloodlines: SavedBloodline[];
    /** mirror minted caches + ryo onto the local save (server already credited).
     *  A React dispatcher so the mirror is a FUNCTIONAL update — the fight runs
     *  for minutes, so a captured `character` would be stale by settle time. */
    updateCharacter?: Dispatch<SetStateAction<Character | null>>;
    onRecordBattle?: (entry: BattleHistoryEntry) => void;
    onExit: () => void;
}) {
    // The vault interior + the explored-tile set live in ONE state so `seen`
    // accumulates inside the same event-driven update that moves the player
    // (the strict hooks lints bar both render-time ref mutation and
    // setState-in-effect for this).
    const [world, setWorld] = useState<{ run: HollowGateShrineRun; seen: Set<number> }>(() => {
        const r = buildVaultInterior();
        return { run: r, seen: new Set(computeHollowGateVisible(r)) };
    });
    const run = world.run;
    const seen = world.seen;
    // The raider's client-computed combat extras (pvpItems + equipment passives)
    // — the exact recipe App.tsx uses for Battle Towers, so the sealed fighter
    // matches a tower host. The server clamps every field (sealTowerFighter).
    const hostLoadout = useMemo<TowerHostLoadout>(() => {
        const it = getAllItems(creatorItems);
        return {
            pvpItems: getPvpItemLoadout(character, it),
            bloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
            armorFactor: getCharacterArmorFactor(character, it),
            armorRawDR: getCharacterArmorRawDR(character, it),
            itemDamagePct: getEquippedItemBonus(character, it, "damagePercent"),
            itemAbsorbPct: getEquippedItemBonus(character, it, "absorbPercent"),
            itemReflectPct: getEquippedItemBonus(character, it, "reflectPercent"),
            itemLifeStealPct: getEquippedItemBonus(character, it, "lifeStealPercent"),
            itemShield: getEquippedItemBonus(character, it, "shield"),
        };
    }, [character, creatorItems, savedBloodlines]);
    const [phase, setPhase] = useState<Phase>("traverse");
    const [fight, setFight] = useState<{ runId: string; session: TowerSession; anbuName: string } | null>(null);
    const [report, setReport] = useState<InfilReportResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);
    // Boss room: true once the player reaches the Anbu at the vault, opening the
    // Challenge / Retreat confrontation (the fight no longer auto-starts on step).
    const [challenge, setChallenge] = useState(false);
    // The masked, anonymous face of this village's vault defender.
    const anbuAvatar = anbuAvatarForVillage(targetVillage);
    const anbuName = anbuDisplayName(targetVillage);
    // Show the mask (not the real appointee's avatar/name) on the enemy actor.
    const maskSession = (s: TowerSession): TowerSession => ({
        ...s,
        actors: s.actors.map(a => a.side === "enemy"
            ? { ...a, name: anbuName, character: { ...a.character, ...(anbuAvatar ? { avatarImage: anbuAvatar } : {}) } }
            : a),
    });
    // Refresh-resume: a stored runId from an interrupted fight is probed once on
    // mount; success jumps straight back into the live fight (the server run
    // lives 45 min). Failure (expired/settled) clears the key and the vault is
    // entered fresh. Note: the run stays bound to ITS sector server-side even if
    // the player reopened a different sector's vault to get here.
    const [resumeRunId, setResumeRunId] = useState<string | null>(() => {
        try { return localStorage.getItem(INFIL_RUN_KEY); } catch { return null; }
    });
    useEffect(() => {
        if (!resumeRunId) return;
        let alive = true;
        fetchInfiltrationState(resumeRunId, character.name)
            .then(res => {
                if (!alive) return;
                setFight({ runId: resumeRunId, session: maskSession(res.session), anbuName: res.anbu.name });
                setPhase("fight");
                setResumeRunId(null);
            })
            .catch(() => {
                if (!alive) return;
                try { localStorage.removeItem(INFIL_RUN_KEY); } catch { /* storage disabled */ }
                setResumeRunId(null);
            });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resumeRunId]);

    const w = run.width;
    const playerIdx = run.playerY * w + run.playerX;
    const visible = useMemo(() => computeHollowGateVisible(run), [run]);
    const seenRef = useRef(seen);
    useEffect(() => { seenRef.current = seen; });

    // ── walking (event-driven click-to-move + arrows; lean local version) ──────
    const pathRef = useRef<number[]>([]);
    const timerRef = useRef<number | null>(null);
    const runRef = useRef(run);
    // Live mirrors for timer callbacks (pumpWalk fires between renders, so the
    // closure-captured phase/starting would be stale there).
    const phaseRef = useRef(phase);
    const startingRef = useRef(starting);
    useEffect(() => { runRef.current = run; phaseRef.current = phase; startingRef.current = starting; });

    function stopWalk() {
        pathRef.current = [];
        if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    }

    // ── the vault: start the server-auth Anbu fight (fired from the boss-room
    //    Challenge confirm, not on step) ────────────────────────────────────────
    async function enterVault() {
        if (startingRef.current || phaseRef.current !== "traverse") return;
        setStarting(true); setError(null);
        try {
            const res = await startInfiltration(character.name, sector, hostLoadout as unknown as Record<string, unknown>);
            try { localStorage.setItem(INFIL_RUN_KEY, res.runId); } catch { /* storage disabled */ }
            setChallenge(false);
            setFight({ runId: res.runId, session: maskSession(res.session), anbuName: res.anbu.name });
            setPhase("fight");
        } catch (e) {
            setError(String((e as Error)?.message ?? e));
        } finally {
            setStarting(false);
        }
    }

    function stepTo(idx: number): boolean {
        const cur = runRef.current;
        const tile = cur.tiles[idx];
        if (!tile || tile.kind === "wall") return false;
        // The Anbu holds the vault tile — you don't step ONTO them. Reaching the
        // vault (walk destination or an arrow-step into it) stops you adjacent and
        // opens the Challenge / Retreat confrontation (the boss room).
        if (tile.kind === "boss") { stopWalk(); setChallenge(true); return false; }
        const next = { ...cur, playerX: idx % cur.width, playerY: Math.floor(idx / cur.width) };
        runRef.current = next;
        setWorld(prev => {
            const nextSeen = new Set(prev.seen);
            computeHollowGateVisible(next).forEach(i => nextSeen.add(i));
            return { run: next, seen: nextSeen };
        });
        return true;
    }

    function pumpWalk() {
        const nextIdx = pathRef.current.shift();
        if (nextIdx == null) { timerRef.current = null; return; }
        if (!stepTo(nextIdx)) { stopWalk(); return; }
        timerRef.current = window.setTimeout(pumpWalk, STEP_MS);
    }

    function walkTo(targetIdx: number) {
        if (phase !== "traverse" || starting) return;
        const path = findHollowGatePath(runRef.current, targetIdx, seenRef.current);
        if (!path || path.length === 0) return;
        stopWalk();
        pathRef.current = path;
        timerRef.current = window.setTimeout(pumpWalk, STEP_MS);
    }

    useEffect(() => {
        if (phase !== "traverse") return;
        const onKey = (e: KeyboardEvent) => {
            const d: Record<string, [number, number]> = {
                ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
                w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
            };
            const delta = d[e.key];
            if (!delta) return;
            e.preventDefault();
            stopWalk();
            const cur = runRef.current;
            const nx = cur.playerX + delta[0], ny = cur.playerY + delta[1];
            if (nx < 0 || ny < 0 || nx >= cur.width || ny >= cur.height) return;
            stepTo(ny * cur.width + nx);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, starting]);

    useEffect(() => () => stopWalk(), []);

    // settleFn adapter for BattleTowerFight: report the run, keep the response
    // for the result panel, and mirror the minted caches + ryo onto the local
    // save (the SERVER already credited them under the save lock — this only
    // keeps the visible inventory in sync until the next authoritative pull).
    async function settleInfiltration(runId: string, _playerName: string): Promise<unknown> {
        const r = await reportInfiltration(runId, character.name);
        try { localStorage.removeItem(INFIL_RUN_KEY); } catch { /* storage disabled */ }
        setReport(r);
        if (r.ok && r.won && !("alreadySettled" in r && r.alreadySettled) && updateCharacter) {
            const won = r as Extract<InfilReportResponse, { won: true; alreadySettled: false }>;
            updateCharacter(prev => {
                if (!prev) return prev;
                const stacks = Array.isArray(prev.itemStacks) ? prev.itemStacks.map(s => ({ ...s })) : [];
                const mint = (itemId: string, add: number) => {
                    if (add <= 0) return;
                    const st = stacks.find(s => s.itemId === itemId);
                    if (st) st.count = Math.min(9999, st.count + add);
                    else stacks.push({ itemId, count: Math.min(9999, add) });
                };
                mint(INFIL_CACHE_ITEM_IDS.warSupply, won.supplyCaches);
                mint(INFIL_CACHE_ITEM_IDS.warResources, won.wrCaches);
                return { ...prev, itemStacks: stacks, ryo: (prev.ryo ?? 0) + won.ryo };
            });
        }
        setPhase("result");
        return r;
    }

    // ── render helpers ─────────────────────────────────────────────────────────
    const themeImg = (role: string) => sharedImages[`shrine:icon-theme-warvault-${role}`];
    function tileArt(idx: number): { img?: string; fallback: string } {
        const t = run.tiles[idx];
        if (!t) return { fallback: "#0c0f16" };
        if (t.kind === "wall" || t.terrain === "wall") {
            // south-facing masonry where the tile below is walkable (depth read)
            const below = run.tiles[idx + w];
            const isFace = !!below && below.kind !== "wall" && below.terrain !== "wall";
            return { img: themeImg(isFace ? "wall-face" : "wall"), fallback: isFace ? "#333b49" : "#171c26" };
        }
        if (t.terrain === "door") return { img: themeImg("door"), fallback: "#2a303d" };
        if (t.terrain === "corridor_floor") return { img: themeImg("corridor"), fallback: "#262c38" };
        return { img: themeImg("floor"), fallback: "#3a4150" };
    }

    // ── phases ─────────────────────────────────────────────────────────────────
    if (resumeRunId) {
        return (
            <div style={{ display: "grid", placeItems: "center", minHeight: "40dvh", color: "#cbd5e1" }}>
                <p>Rejoining your infiltration…</p>
            </div>
        );
    }

    if (phase === "fight" && fight) {
        return (
            <BattleTowerFight
                character={character}
                sharedImages={sharedImages}
                hostLoadout={hostLoadout}
                runId={fight.runId}
                initialSession={fight.session}
                onExit={() => {
                    // Leaving pre-report abandons the run (the attempt stays
                    // burned — the raid-start mint-cap rule); post-report just
                    // returns to the spoils panel.
                    try { localStorage.removeItem(INFIL_RUN_KEY); } catch { /* storage disabled */ }
                    if (report) setPhase("result"); else onExit();
                }}
                onRecordBattle={onRecordBattle}
                actionFn={infiltrationAct}
                settleFn={settleInfiltration}
                settleOnAnyDone
            />
        );
    }

    if (phase === "result") {
        const won = report?.ok && report.won ? report : null;
        const fresh = won && !("alreadySettled" in won && won.alreadySettled)
            ? (won as Extract<InfilReportResponse, { won: true; alreadySettled: false }>)
            : null;
        return (
            <div style={{ maxWidth: 560, margin: "0 auto", padding: "1.2rem", textAlign: "center" }}>
                <h2 style={{ margin: "0.4rem 0" }}>{won ? "Vault Breached" : "The Anbu Held"}</h2>
                <p style={{ opacity: 0.85 }}>
                    {won
                        ? `You slipped past ${targetVillage}'s defenses and cracked the war vault in Sector ${sector}.`
                        : `${fight?.anbuName ?? "The defending Anbu"} repelled your raid on Sector ${sector}. No spoils — the vault stands.`}
                </p>
                {fresh && (
                    <div style={{ display: "grid", gap: 8, margin: "1rem auto", maxWidth: 380, textAlign: "left" }}>
                        {fresh.supplyCaches > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(58,65,80,0.35)", border: "1px solid rgba(120,130,150,0.35)", borderRadius: 10, padding: "8px 12px" }}>
                                <img src="/items/war-supply-cache.webp" alt="" style={{ width: 40, height: 40 }} />
                                <div><b>{fresh.supplyCaches}× War Supply Cache</b><div style={{ fontSize: 12, opacity: 0.75 }}>Turn in to your CLAN (2 : 1 clan points)</div></div>
                            </div>
                        )}
                        {fresh.wrCaches > 0 && (
                            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(58,65,80,0.35)", border: "1px solid rgba(120,130,150,0.35)", borderRadius: 10, padding: "8px 12px" }}>
                                <img src="/items/war-resource-cache.webp" alt="" style={{ width: 40, height: 40 }} />
                                <div><b>{fresh.wrCaches}× War Resource Cache</b><div style={{ fontSize: 12, opacity: 0.75 }}>Turn in to your VILLAGE (1 : 1 merit)</div></div>
                            </div>
                        )}
                        {fresh.supplyCaches === 0 && fresh.wrCaches === 0 && (
                            <div style={{ opacity: 0.8, fontSize: 13 }}>The vault's reserves were already bled dry today — its daily loss limit is spent.</div>
                        )}
                        <div style={{ fontSize: 14 }}>+{fresh.ryo.toLocaleString()} ryo</div>
                    </div>
                )}
                <button className="spire-result-btn" onClick={onExit}>Slip Away</button>
            </div>
        );
    }

    // traverse
    return (
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "0.6rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <h3 style={{ margin: "0.2rem 0" }}>War Vault — Sector {sector}</h3>
                <span style={{ fontSize: 12, opacity: 0.75 }}>{targetVillage} territory · reach the Anbu holding the vault</span>
            </div>
            {error && (
                <div style={{ background: "rgba(180,40,40,0.18)", border: "1px solid rgba(220,80,80,0.5)", borderRadius: 8, padding: "6px 10px", margin: "6px 0", fontSize: 13 }}>
                    {error}
                </div>
            )}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${w}, ${TILE}px)`,
                    justifyContent: "center",
                    margin: "8px auto",
                    userSelect: "none",
                    touchAction: "manipulation",
                }}
            >
                {run.tiles.map((t, idx) => {
                    const lit = visible.has(idx);
                    const isSeen = seen.has(idx);
                    const { img, fallback } = tileArt(idx);
                    const isPlayer = idx === playerIdx;
                    const isVault = t.kind === "boss";
                    const decoImg = t.decoration != null && t.kind === "empty" && t.roomId != null
                        ? themeImg(`deco-${(t.decoration % 2) + 1}`)
                        : undefined;
                    return (
                        <div
                            key={idx}
                            onClick={() => walkTo(idx)}
                            style={{
                                width: TILE, height: TILE, position: "relative", cursor: isSeen ? "pointer" : "default",
                                background: img && isSeen ? `url(${img}) center/cover` : fallback,
                                filter: lit ? "none" : isSeen ? "brightness(0.45)" : "brightness(0.08)",
                                transition: "filter 200ms",
                            }}
                        >
                            {decoImg && isSeen && <img src={decoImg} alt="" draggable={false} style={{ position: "absolute", inset: "12%", width: "76%", height: "76%", objectFit: "contain", pointerEvents: "none" }} />}
            {isVault && isSeen && (
                                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", zIndex: 2 }}>
                                    <div style={{ position: "absolute", inset: "4%", borderRadius: "50%", background: "radial-gradient(circle, rgba(220,60,60,0.55), rgba(220,60,60,0) 70%)" }} />
                                    {anbuAvatar
                                        ? <img src={anbuAvatar} alt={anbuName} draggable={false} style={{ position: "relative", width: "98%", height: "98%", objectFit: "contain", filter: "drop-shadow(0 3px 9px rgba(0,0,0,0.75))" }} />
                                        : <div style={{ width: "70%", height: "70%", borderRadius: 8, boxShadow: "0 0 14px rgba(220,60,60,0.75)", background: themeImg("deco-2") ? `url(${themeImg("deco-2")}) center/contain no-repeat` : "rgba(220,60,60,0.4)" }} />}
                                </div>
                            )}
                            {isPlayer && (
                                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
                                    {character.avatarImage
                                        ? <img src={character.avatarImage} alt="" style={{ width: TILE * 0.72, height: TILE * 0.72, borderRadius: "50%", border: "2px solid rgba(240,240,255,0.9)", objectFit: "cover", boxShadow: "0 2px 8px rgba(0,0,0,0.6)" }} />
                                        : <div style={{ width: TILE * 0.6, height: TILE * 0.6, borderRadius: "50%", background: "#e8ecf5", border: "2px solid #38405a" }} />}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, opacity: 0.7, alignSelf: "center" }}>
                    {starting ? "Squaring off…" : `Tap a tile or use WASD/arrows. ${anbuName} guards the vault at the far end — walk up to challenge them.`}
                </span>
                <button onClick={onExit} style={{ padding: "0.45rem 1rem" }}>Leave the sector</button>
            </div>

            {/* Boss room — the Challenge / Retreat confrontation at the vault. */}
            {challenge && (
                <div
                    style={{ position: "fixed", inset: 0, zIndex: 1000001, display: "grid", placeItems: "center", background: "rgba(4,6,12,0.8)" }}
                    onClick={() => { if (!starting) setChallenge(false); }}
                >
                    <div
                        style={{ background: "#141926", border: "1px solid #4a2530", borderRadius: 16, padding: "1.2rem 1.3rem", maxWidth: 420, width: "min(93vw, 420px)", textAlign: "center", boxShadow: "0 0 40px rgba(220,60,60,0.25)" }}
                        onClick={e => e.stopPropagation()}
                    >
                        {anbuAvatar
                            ? <img src={anbuAvatar} alt={anbuName} style={{ width: 168, height: 168, objectFit: "contain", filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.65))" }} />
                            : <div style={{ fontSize: 60 }}>🥷</div>}
                        <h3 style={{ margin: "0.2rem 0 0.1rem", color: "#f0c8c8", letterSpacing: ".01em" }}>{anbuName}</h3>
                        <p style={{ fontSize: 13, opacity: 0.85, margin: "0.35rem 0 0.9rem", lineHeight: 1.5 }}>
                            The vault is sealed behind a masked {targetVillage.replace(/\s+Village$/i, "")} operative — full strength, and they only need to hold. Beat them and you bleed this sector&rsquo;s war economy. Fall, and you leave with nothing.
                        </p>
                        {error && (
                            <div style={{ background: "rgba(180,40,40,0.18)", border: "1px solid rgba(220,80,80,0.5)", borderRadius: 8, padding: "6px 10px", margin: "0 0 10px", fontSize: 13 }}>{error}</div>
                        )}
                        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                            <button onClick={() => void enterVault()} disabled={starting} style={{ padding: "0.6rem 1.3rem", background: "linear-gradient(#7f1d1d,#450a0a)", borderColor: "#f87171", fontWeight: 700 }}>
                                {starting ? "Engaging…" : "Challenge"}
                            </button>
                            <button onClick={() => setChallenge(false)} disabled={starting} style={{ padding: "0.6rem 1.3rem", opacity: 0.85 }}>Retreat</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
