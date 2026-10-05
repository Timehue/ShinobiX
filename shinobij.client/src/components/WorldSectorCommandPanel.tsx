import {
    GiCrossedSwords,
    GiPawPrint,
    GiShield,
} from "./icons/LightweightGameIcons";
import { TERRITORY_CONTROL_MAX, TERRITORY_HP_MAX } from "../constants/game";
import { biomeLabel } from "../data/world";
import { sectorGatherLineFor } from "../lib/sector-pool";
import { sectorContestLabel } from "../lib/sector-war-engagement";
import { SectorTracesCard } from "./SectorTraces";
import { SectorGatherReadout } from "./SectorGatherReadout";
import { SectorIntelCard } from "./SectorIntelCard";
import { SectorOrderCard } from "./SectorOrderCard";
import { SectorContractCard } from "./SectorContractCard";
import { SectorSkyForecast } from "./SectorSkyForecast";
// Re-export sibling row/prop shapes for existing callers.
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
 * WorldMap owns capability reads, navigation, and mutations. This leaf receives
 * projected rows and callbacks and makes no authority decision.
 */
export function WorldSectorCommandPanel({
    sector,
    present,
    biome,
    weather,
    territory,
    gathering,
    contract,
    contractBusy,
    intel = null,
    order = null,
    villageWarAdmissionOpen,
    traces,
    sectorContest,
    sectorGarrisonReady,
    hunt,
    onRaidEnemyVillage,
    onRaidControlledSector,
    onOpenSigns,
    onOpenShrine,
    onOpenSectorContest,
    onFightSectorGarrison,
    onClaimContract,
}: WorldSectorCommandPanelProps) {
    // The shared pool decides whether Explore can do anything. `gather` is null
    // off a wild sector and `pending` pre-poll; neither may refuse the verb.
    const gather = sectorGatherLineFor(gathering);
    return (
        <aside className="sector-command-panel sector-details-body" aria-label={`Sector ${sector} command panel`}>
            <header className="sector-panel-heading">
                <div className="sector-panel-kicker">
                    <span className={`sector-biome-token sector-biome-${biome}`}>{biomeLabel(biome)}</span>
                    <span><SectorSkyForecast sector={sector} biome={biome} fallback={weather} /></span>
                </div>
                {gather && <SectorGatherReadout gather={gather} />}
                <SectorSkyForecast sector={sector} biome={biome} fallback={weather} variant="effect" />
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
                            <button type="button" className="danger-button sector-action-btn is-danger" disabled={!present || !villageWarAdmissionOpen || territory.war.warGroundHp <= 0 || territory.war.ended} onClick={onRaidEnemyVillage}>
                                <span className="sector-action-icon" aria-hidden="true"><GiCrossedSwords /></span>
                                <span>Raid Enemy Village</span>
                            </button>
                        </div>
                    )}
                    {territory.enemyControlled && (
                        <button type="button" className="danger-button sector-action-btn is-danger" disabled={!present || !villageWarAdmissionOpen} onClick={onRaidControlledSector}>
                            <span className="sector-action-icon" aria-hidden="true"><GiCrossedSwords /></span>
                            <span>Raid Controlled Sector</span>
                        </button>
                    )}
                </section>
            )}
            {contract && <SectorContractCard status={contract} busy={contractBusy} disabled={!present} onClaim={onClaimContract} />}
            {intel && <SectorIntelCard intel={intel} />}
            {order && <SectorOrderCard order={order} />}
            {traces && (
                <SectorTracesCard
                    traces={traces}
                    onOpenSigns={onOpenSigns}
                    onOpenShrine={onOpenShrine}
                />
            )}
            {sectorContest && (
                <section className="sector-presence sector-panel-card">
                    <div className="sector-panel-card-head">
                        <h4><GiCrossedSwords aria-hidden="true" />Sector War</h4>
                        <span className="sector-status-pill is-owned">{sectorContestLabel(sectorContest.winCondition)}</span>
                    </div>
                    <p className="sector-owner-line">
                        <strong>{sectorContest.attackerVillage}</strong>
                        <span>attacking {sectorContest.defenderVillage}</span>
                    </p>
                    <p className="sector-empty-note">
                        This sector is contested with {sectorContestLabel(sectorContest.winCondition).toLowerCase()}s, so attacking here opens that table — a shinobi fight scores nothing for the war.
                    </p>
                    <button
                        type="button"
                        className="danger-button sector-action-btn is-danger"
                        disabled={!present || !villageWarAdmissionOpen}
                        onClick={onOpenSectorContest}
                    >
                        <span className="sector-action-icon" aria-hidden="true"><GiCrossedSwords /></span>
                        <span>{sectorContestLabel(sectorContest.winCondition)}</span>
                    </button>
                    {sectorGarrisonReady && (
                        <>
                            <p className="sector-empty-note">
                                No defender has answered for hours. Fight the garrison instead &mdash; it scores less than beating a real defender, but an absent defence no longer holds the sector for free.
                            </p>
                            <button
                                type="button"
                                className="danger-button sector-action-btn is-danger"
                                disabled={!present || !villageWarAdmissionOpen}
                                onClick={onFightSectorGarrison}
                            >
                                <span className="sector-action-icon" aria-hidden="true"><GiShield /></span>
                                <span>Fight Garrison</span>
                            </button>
                        </>
                    )}
                </section>
            )}
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
        </aside>
    );
}
