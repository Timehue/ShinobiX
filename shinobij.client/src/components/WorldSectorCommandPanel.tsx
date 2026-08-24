import {
    GiCompass,
    GiCrossedSwords,
    GiExitDoor,
    GiHealthPotion,
    GiPawPrint,
    GiShield,
} from "./icons/LightweightGameIcons";
import { TERRITORY_CONTROL_MAX, TERRITORY_HP_MAX } from "../constants/game";
import { biomeLabel, weatherEffects } from "../data/world";
import { sectorRegionName } from "../data/sectors";
import { sectorGatherLineFor } from "../lib/sector-pool";
import { sectorName } from "../../../shared/sector-geo";
import { SectorTracesCard } from "./SectorTraces";
import { SectorGatherReadout } from "./SectorGatherReadout";
import { SectorIntelCard } from "./SectorIntelCard";

// Row/prop shapes live in a sibling module (see its header); re-exported here
// so every existing import of these names keeps working unchanged.
export type {
    WorldSectorCommandWar,
    WorldSectorCommandTerritory,
    WorldSectorCommandPlayerStatus,
    WorldSectorCommandPlayer,
    WorldSectorCommandHunt,
    WorldSectorCommandPanelProps,
} from "./WorldSectorCommandPanel.types";

import type { WorldSectorCommandPanelProps } from "./WorldSectorCommandPanel.types";

/**
 * Presentation-only command surface for a selected sector.
 *
 * WorldMap owns capability reads, network work, navigation, and mutations. This
 * leaf receives already-projected rows plus command callbacks so it cannot make
 * an authority decision from display state alone.
 */
export function WorldSectorCommandPanel({
    sector,
    biome,
    weather,
    territory,
    gathering,
    intel = null,
    villageWarAdmissionOpen,
    traces,
    hasLivePlayers,
    players,
    hunt,
    onRaidEnemyVillage,
    onRaidControlledSector,
    onOpenSigns,
    onOpenShrine,
    onStrikeSleeper,
    onAttackPlayer,
    onExplore,
    onHunt,
    onRecover,
    onLeave,
}: WorldSectorCommandPanelProps) {
    // The shared pool decides whether Explore can do anything. `gather` is null
    // off a wild sector and `pending` pre-poll; neither may refuse the verb.
    const gather = sectorGatherLineFor(gathering);
    const gatherDepleted = gather?.depleted === true;
    return (
        <aside className="instance-actions sector-command-panel" aria-label={`Sector ${sector} command panel`}>
            <header className="sector-panel-heading">
                <div className="sector-panel-kicker">
                    <span className={`sector-biome-token sector-biome-${biome}`}>{biomeLabel(biome)}</span>
                    <span>{weatherEffects[weather].name}</span>
                </div>
                <h3>{sectorName(sector) ?? `Sector ${sector}`}</h3>
                <small className="sector-panel-sub">Sector {sector} · {sectorRegionName(sector)}</small>
                {gather && <SectorGatherReadout gather={gather} />}
                <p>{weatherEffects[weather].effect}</p>
            </header>

            {territory && (
                <section className="summary-box sector-panel-card sector-territory-card">
                    <div className="sector-panel-card-head">
                        <h4><GiShield aria-hidden="true" />Territory</h4>
                        <span className={`sector-status-pill ${territory.isOwned ? "is-owned" : ""}`}>{territory.breached ? "Breached" : territory.isOwned ? "Owned" : "Open"}</span>
                    </div>
                    {territory.isLive ? (
                        <>
                            <p className="sector-owner-line"><strong>Owner</strong><span>{territory.ownerLabel}</span></p>
                            {territory.breached && (
                                <p className="sector-rebuild-note">Breached: rewards and bonuses are suspended. The owner must restore HP before the fixed {territory.breachMinsLeft}m deadline or lose the sector.</p>
                            )}
                            {!territory.breached && territory.rewardsSuspended && (
                                <p className="sector-rebuild-note">Dormant hold: rewards and bonuses are suspended until the clan returns.</p>
                            )}
                            {!territory.isOwned && territory.rebuildMinsLeft > 0 && (
                                <p className="sector-rebuild-note">Recovering: capturable in {territory.rebuildMinsLeft}m</p>
                            )}
                            <div className="sector-meter-block">
                                <div className="sector-meter-row">
                                    <span>Control</span>
                                    <strong>{territory.controlScore.toLocaleString()} / {TERRITORY_CONTROL_MAX.toLocaleString()}</strong>
                                </div>
                                <div className="sector-meter sector-meter-control"><span style={{ width: `${(territory.controlScore / TERRITORY_CONTROL_MAX) * 100}%` }} /></div>
                            </div>
                            <div className="sector-meter-block">
                                <div className="sector-meter-row">
                                    <span>HP</span>
                                    <strong>{territory.hp.toLocaleString()} / {TERRITORY_HP_MAX.toLocaleString()}</strong>
                                </div>
                                <div className="sector-meter sector-meter-hp"><span style={{ width: `${(territory.hp / TERRITORY_HP_MAX) * 100}%` }} /></div>
                            </div>
                            <p className="sector-guard-list"><strong>Guards</strong><span>{territory.guards.length ? territory.guards.join(", ") : "None"}</span></p>
                        </>
                    ) : (
                        <p className="sector-territory-idle-note">Unclaimed — no clan holds this sector, so nothing here is contested.</p>
                    )}
                    {territory.war && (
                        <div className="summary-box sector-panel-card sector-war-card">
                            <div className="sector-panel-card-head">
                                <h4><GiCrossedSwords aria-hidden="true" />War Ground</h4>
                            </div>
                            <p>{territory.war.playerVillage} vs {territory.war.enemyVillage}</p>
                            <div className="sector-meter-block">
                                <div className="sector-meter-row">
                                    <span>Ground HP</span>
                                    <strong>{territory.war.warGroundHp.toLocaleString()} / {territory.war.warGroundHpMax.toLocaleString()}</strong>
                                </div>
                                <div className="sector-meter sector-meter-hp"><span style={{ width: `${(territory.war.warGroundHp / territory.war.warGroundHpMax) * 100}%` }} /></div>
                            </div>
                            <div className="sector-meter-block">
                                <div className="sector-meter-row">
                                    <span>{territory.war.enemyVillage ?? "Enemy"} HP</span>
                                    <strong>{territory.war.enemyVillageHp.toLocaleString()} / {territory.war.enemyVillageHpMax.toLocaleString()}</strong>
                                </div>
                                <div className="sector-meter sector-meter-hp"><span style={{ width: `${(territory.war.enemyVillageHp / territory.war.enemyVillageHpMax) * 100}%` }} /></div>
                            </div>
                            <button type="button" className="danger-button sector-action-btn is-danger" disabled={!villageWarAdmissionOpen || territory.war.warGroundHp <= 0 || territory.war.ended} onClick={onRaidEnemyVillage}>
                                <span className="sector-action-icon" aria-hidden="true"><GiCrossedSwords /></span>
                                <span>Raid Enemy Village</span>
                            </button>
                        </div>
                    )}
                    {territory.enemyControlled && (
                        <button type="button" className="danger-button sector-action-btn is-danger" disabled={!villageWarAdmissionOpen} onClick={onRaidControlledSector}>
                            <span className="sector-action-icon" aria-hidden="true"><GiCrossedSwords /></span>
                            <span>Raid Controlled Sector</span>
                        </button>
                    )}
                </section>
            )}
            {intel && <SectorIntelCard intel={intel} />}
            {traces && (
                <SectorTracesCard
                    traces={traces}
                    onOpenSigns={onOpenSigns}
                    onOpenShrine={onOpenShrine}
                />
            )}
            <section className="sector-presence sector-panel-card">
                <div className="sector-panel-card-head">
                    <h4>Players Here</h4>
                    {hasLivePlayers && <span className="live-badge">LIVE</span>}
                </div>
                {players.length === 0 ? (
                    <span className="sector-empty-note">No other players in this sector.</span>
                ) : (
                    players.map((player) => (
                        <div className="sector-player-card" key={player.name}>
                            <div className="sector-player-avatar" aria-hidden="true">
                                {player.avatarSrc
                                    ? <img className="sector-player-avatar-img" src={player.avatarSrc} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                                    : <span className="sector-player-avatar-emoji">{player.name.slice(0, 2).toUpperCase()}</span>}
                            </div>
                            <div className="sector-player-info">
                                <strong>{player.name}</strong>
                                <small>Level {player.level}</small>
                                <span className={`sector-status-pill is-${player.status.toLowerCase()}`}>{player.status}</span>
                            </div>
                            {player.sleeping ? (
                                <button type="button" className="danger-button sector-player-action" onClick={() => onStrikeSleeper(player.target)}>
                                    <span className="sector-action-icon" aria-hidden="true"><GiCrossedSwords /></span>
                                    <span>Strike Down</span>
                                </button>
                            ) : (
                                <button type="button" className="danger-button sector-player-action" disabled={player.actionDisabled} onClick={() => onAttackPlayer(player.target)}>
                                    <span className="sector-action-icon" aria-hidden="true"><GiCrossedSwords /></span>
                                    <span>{player.status === "Traveling" ? "Traveling" : (player.status === "Fighting" ? "Fighting" : "Attack")}</span>
                                </button>
                            )}
                        </div>
                    ))
                )}
            </section>
            {hunt && (
                <section className="sector-presence sector-panel-card">
                    <div className="sector-panel-card-head">
                        <h4><GiPawPrint aria-hidden="true" />Hunt Trail</h4>
                        <span className={`sector-status-pill ${hunt.ready ? "is-owned" : ""}`}>
                            {hunt.ready ? "Fight" : "Tracking"}
                        </span>
                    </div>
                    <p className="sector-owner-line">
                        <strong>{hunt.targetName}</strong>
                        <span>{Math.min(hunt.progress, Math.max(0, hunt.requiredTracks - 1))}/{Math.max(1, hunt.requiredTracks - 1)} trail</span>
                    </p>
                    <p className="sector-empty-note">
                        {hunt.ready
                            ? "The trail is hot. Start the fight from this sector."
                            : "Search the sign here; the trail may move before the target shows itself."}
                    </p>
                </section>
            )}
            <div className="sector-action-grid" aria-label="Sector actions">
                <button type="button" className="sector-action-btn is-primary" disabled={gatherDepleted} onClick={onExplore}>
                    <span className="sector-action-icon" aria-hidden="true"><GiCompass /></span>
                    {gatherDepleted ? <span>Picked clean</span> : <span>Explore</span>}
                </button>
                {hunt && (
                    <button type="button" className="sector-action-btn" onClick={onHunt}>
                        <span className="sector-action-icon" aria-hidden="true"><GiPawPrint /></span>
                        <span>{hunt.ready ? "Fight" : "Track"} {hunt.targetName}</span>
                    </button>
                )}
                <button type="button" className="sector-action-btn" onClick={onRecover}>
                    <span className="sector-action-icon" aria-hidden="true"><GiHealthPotion /></span>
                    <span>Recover</span>
                </button>
                <button type="button" className="sector-action-btn is-ghost" onClick={onLeave}>
                    <span className="sector-action-icon" aria-hidden="true"><GiExitDoor /></span>
                    <span>Leave</span>
                </button>
            </div>
        </aside>
    );
}
