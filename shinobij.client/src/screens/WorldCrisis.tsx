import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { BattleHistoryEntry, Character, VersionedCharacterCommit } from "../types/character";
import type { Screen } from "../types/core";
import type { TowerHostLoadout } from "../lib/towers-api";
import { requestAiFight } from "../lib/ai-fight-request";
import { fetchWorldCrisis } from "../lib/world-crisis";
import { WorldCrisis80 } from "./WorldCrisis80";
import stormveilArt from "../assets/map-landmarks/stormveil.webp";
import ashenLeafArt from "../assets/map-landmarks/ashen-leaf.webp";
import frostfangArt from "../assets/map-landmarks/frostfang.webp";
import moonshadowArt from "../assets/map-landmarks/moonshadow.webp";
import {
    WORLD_CRISIS_TITLE,
    WORLD_CRISIS_VILLAGES,
    isWorldCrisisVillage,
    worldCrisisEncounterForVillage,
    worldCrisisPhaseLabel,
    type WorldCrisisProjection,
    type WorldCrisisVillage,
} from "../../../shared/world-crisis";
import "./WorldCrisis.css";

const VILLAGE_ART: Record<WorldCrisisVillage, string> = {
    "Stormveil Village": stormveilArt,
    "Ashen Leaf Village": ashenLeafArt,
    "Frostfang Village": frostfangArt,
    "Moonshadow Village": moonshadowArt,
};

function openWorldNews(setScreen: (screen: Screen) => void) {
    try { window.sessionStorage?.setItem("hall.initialTab", "news"); } catch { /* best effort */ }
    setScreen("hallOfLegends");
}

export function WorldCrisis({ character, setScreen, sharedImages, hostLoadout, onVersionedCharacter, onRecordBattle }: { character: Character; setScreen: (screen: Screen) => void; sharedImages: Record<string, string>; hostLoadout?: TowerHostLoadout; onVersionedCharacter?: VersionedCharacterCommit; onRecordBattle?: (entry: BattleHistoryEntry) => void }) {
    const [chronicle, setChronicle] = useState<"37" | "80">(() => {
        try { return sessionStorage.getItem("worldCrisis.focus") === "80" ? "80" : "37"; }
        catch { return "37"; }
    });
    useEffect(() => {
        try { sessionStorage.removeItem("worldCrisis.focus"); } catch { /* best effort */ }
    }, []);
    const village = isWorldCrisisVillage(character.village) ? character.village : "Stormveil Village";
    const encounter = worldCrisisEncounterForVillage(village);
    const [crisis, setCrisis] = useState<WorldCrisisProjection | null>(null);
    const [loading, setLoading] = useState(true);
    const [launching, setLaunching] = useState(false);
    const [error, setError] = useState("");
    const refresh = useCallback(async () => {
        const next = await fetchWorldCrisis();
        if (next) { setCrisis(next); setError(""); }
        else setError("The village signal could not be reached.");
        setLoading(false);
    }, []);

    useEffect(() => {
        const start = window.setTimeout(() => { void refresh(); }, 0);
        const timer = window.setInterval(() => { void refresh(); }, 12_000);
        return () => { window.clearTimeout(start); window.clearInterval(timer); };
    }, [refresh]);

    const local = crisis?.villages[village];
    const active = crisis?.status === "active" && local?.attackersActive === true;
    const resolved = crisis?.status === "resolved";
    const locked = crisis?.status === "armed" || crisis?.status === "dormant";

    function defend() {
        if (!active || launching) return;
        setLaunching(true);
        setError("");
        const accepted = requestAiFight({
            opponentId: encounter.sourceId,
            opponentLevel: character.level,
            battleKind: "world",
            opponentName: encounter.name,
            enemyAvatar: encounter.portrait,
            sector: 0,
            returnScreen: "worldCrisis",
            worldEncounter: { kind: "world-crisis", sourceId: encounter.sourceId, sector: 0 },
            onResolved: () => { setLaunching(false); void refresh(); },
        });
        if (!accepted) {
            setLaunching(false);
            setError("Combat command is unavailable. Return to the village and try again.");
        }
    }

    if (chronicle === "80") return <WorldCrisis80 character={character} setScreen={setScreen} sharedImages={sharedImages} hostLoadout={hostLoadout} onVersionedCharacter={onVersionedCharacter} onRecordBattle={onRecordBattle} onSwitch={() => setChronicle("37")} />;

    return (
        <section className={`world-crisis world-crisis--${crisis?.status ?? "loading"}`} aria-labelledby="world-crisis-title">
            <nav className="crisis-chronicle-tabs" aria-label="World crisis chronicle">
                <button type="button" className="is-active" aria-current="page">Level 37 · Fourfold Breach</button>
                <button type="button" onClick={() => setChronicle("80")}>Level 80 · Hollow Gate Reckoning</button>
            </nav>
            <header className="world-crisis__header">
                <button type="button" className="world-crisis__back" onClick={() => setScreen("village")}>← Village</button>
                <div>
                    <span className="world-crisis__eyebrow">Server-wide emergency · Village outskirts</span>
                    <h1 id="world-crisis-title">{WORLD_CRISIS_TITLE}</h1>
                    <p>The quartered seal issued one recall order through four old civic works. The wardens are not invading from another world. They are village machinery obeying a command that should have stayed buried.</p>
                </div>
                <button type="button" className="world-crisis__news" onClick={() => openWorldNews(setScreen)}>Watch World News</button>
            </header>

            <div className="world-crisis__status" role="status" aria-live="polite">
                <span>{crisis ? worldCrisisPhaseLabel(crisis.phase) : "Reading the seal"}</span>
                <strong>{crisis ? `${crisis.globalProgressPercent}% WORLD DEFENSE` : "CONNECTING"}</strong>
                {crisis?.awakenedBy && <small>Awakened when {crisis.awakenedBy} crossed level {crisis.triggerLevel}</small>}
            </div>

            {error && <div className="world-crisis__error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Retry</button></div>}

            <div className="world-crisis__layout">
                <div className="world-crisis__outskirts" style={{ "--village-art": `url(${VILLAGE_ART[village]})` } as CSSProperties}>
                    <div className="world-crisis__sky" aria-hidden="true" />
                    {["north", "east", "south", "west"].map((slot, index) => (
                        <div key={slot} className={`world-crisis__attacker world-crisis__attacker--${slot}`} aria-hidden="true" style={{ "--attack-delay": `${index * -.72}s` } as CSSProperties}>
                            <span className="world-crisis__attack-trail" />
                            <img src={encounter.portrait} alt="" />
                        </div>
                    ))}
                    <div className="world-crisis__village-objective">
                        <span className="world-crisis__seal" aria-hidden="true"><i /><i /><i /><i /></span>
                        <img src={VILLAGE_ART[village]} alt="" />
                        <strong>{village}</strong>
                        <small>VILLAGE OBJECTIVE</small>
                    </div>
                    <div className="world-crisis__integrity">
                        <span><b>Outskirts integrity</b><em>{local?.integrityPercent ?? 40}%</em></span>
                        <div><i style={{ width: `${local?.integrityPercent ?? 40}%` }} /></div>
                    </div>
                </div>

                <aside className="world-crisis__orders">
                    <span className="world-crisis__orders-label">Your defense order</span>
                    <img src={encounter.portrait} alt={`${encounter.name} portrait`} />
                    <h2>{encounter.name}</h2>
                    <p>This is the same hidden machinery uncovered in {village}'s level 35 record. Here it scales to your shinobi, so every level can answer the same world event.</p>
                    <dl>
                        <div><dt>Your level</dt><dd>{character.level}</dd></div>
                        <div><dt>Village defenses</dt><dd>{local?.defenses ?? 0} / {local?.target ?? "?"}</dd></div>
                        <div><dt>Contribution</dt><dd>1 verified win</dd></div>
                    </dl>
                    <button type="button" className="world-crisis__defend" onClick={defend} disabled={!active || launching || loading}>
                        {launching ? "Sealing encounter…" : resolved ? "The villages hold" : locked ? "Awaiting the first omen" : local && !local.attackersActive ? "Outskirts secured" : "Intercept the recall warden"}
                    </button>
                    <small className="world-crisis__authority">Difficulty and contribution are sealed by the server. No ranked season is required.</small>
                </aside>
            </div>

            <section className="world-crisis__fronts" aria-labelledby="world-crisis-fronts-title">
                <div className="world-crisis__section-heading">
                    <div><span>One signal, four fronts</span><h2 id="world-crisis-fronts-title">The villages answer together</h2></div>
                    <strong>{crisis?.totalDefenses ?? 0} / {crisis?.totalTarget ?? "?"} verified defenses</strong>
                </div>
                <div className="world-crisis__front-grid">
                    {WORLD_CRISIS_VILLAGES.map((frontVillage) => {
                        const front = crisis?.villages[frontVillage];
                        return (
                            <article key={frontVillage} className={frontVillage === village ? "is-home" : ""}>
                                <img src={VILLAGE_ART[frontVillage]} alt="" />
                                <div><strong>{frontVillage}</strong><small>{front?.completedAt ? "OUTSKIRTS SECURED" : `${front?.remaining ?? "?"} defenses needed`}</small></div>
                                <span><i style={{ width: `${front?.progressPercent ?? 0}%` }} /></span>
                            </article>
                        );
                    })}
                </div>
            </section>

            {(crisis?.topDefenders.length ?? 0) > 0 && (
                <section className="world-crisis__honor" aria-label="Leading defenders">
                    <span>Field ledger</span>
                    {crisis!.topDefenders.slice(0, 5).map((defender, index) => (
                        <div key={`${defender.player}-${defender.village}`}><b>#{index + 1}</b><strong>{defender.player}</strong><small>{defender.village}</small><em>{defender.wins} wins</em></div>
                    ))}
                </section>
            )}
        </section>
    );
}
