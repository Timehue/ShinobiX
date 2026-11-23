import { SectorHudFrame } from "./SectorHudFrame";
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { sectorGatherLineFor } from '../lib/sector-pool';
import { sectorContestLabel } from '../lib/sector-war-engagement';
import type { SectorPlayerActionState, SectorPlayerIntent } from '../lib/use-sector-player-action';
import type { SectorRosterState } from '../lib/presence-store';
import { SectorNearby } from './SectorNearby';
import { SectorRoutes } from './SectorRoutes';
import { WorldSectorCommandPanel } from './WorldSectorCommandPanel';
import type { WorldSectorCommandPanelProps } from './WorldSectorCommandPanel.types';

export function SectorHud(props: WorldSectorCommandPanelProps & {
    rosterState: SectorRosterState; playerAction: SectorPlayerActionState;
    onPlayerAction: (key: string, sector: number, intent: SectorPlayerIntent, originCurrent?: () => boolean) => void;
    /** The viewer's character name, so sector chat can tell their own lines apart. */
    chatName?: string;
    /** Quest-line steps that can be done in this sector, shown at the top of Sector Info. */
    quest?: ReactNode;
    /** True when `quest` has something to do here, so the HUD can point at it. */
    questHere?: boolean;
}) {
    const { sector, present, biome, players, hunt, territory, sectorContest, chatName = '',
        rosterState, playerAction, onPlayerAction, onExplore, onFindRicherGround,
        onHunt, onOpenSectorContest, villageWarAdmissionOpen } = props;
    const originVersion = useRef(0);
    // Leaving the sector, or closing this HUD, retires read-only navigation, even if WorldMap stays mounted.
    useLayoutEffect(() => () => { originVersion.current += 1; }, [sector]);
    const run = (key: string, fromSector: number, intent: SectorPlayerIntent) => {
        const version = originVersion.current;
        onPlayerAction(key, fromSector, intent, () => originVersion.current === version);
    };
    const gatherDepleted = sectorGatherLineFor(props.gathering)?.depleted === true;
    const dailyActions = props.dailyExplores;
    const dailyCapped = (dailyActions ?? 0) >= 100;
    const dailyLabel = dailyActions !== undefined ? `Explores: ${dailyActions}/100 daily explores${dailyCapped ? ' · Resets at midnight UTC' : ''}` : undefined;

    return <><SectorHudFrame sector={sector} present={present} biome={biome} chatName={chatName}
        claimable={props.contract?.claimable} questHere={props.questHere}
        explore={<button type="button" className="sector-hud-explore" data-sector-explore=""
                    aria-label={gatherDepleted ? 'Find richer ground' : 'Explore'}
                    aria-description={dailyLabel}
                    disabled={!gatherDepleted && (!present || dailyCapped || props.exploreBusy)} onClick={gatherDepleted ? onFindRicherGround : onExplore}>
                    <span>{gatherDepleted ? 'Find richer ground' : dailyActions !== undefined ? `Explore · ${dailyActions}/100` : 'Explore'}</span>
                    <small aria-hidden="true">{gatherDepleted ? 'Follow a richer trail' : dailyCapped ? 'Daily limit reached' : props.exploreBusy ? 'Exploring…' : 'Search this sector'}</small></button>}
        context={<>
            {props.gathering?.hydrated && <span className="sector-hud-summary">Shared sector pool: {gatherDepleted ? 'Gathering depleted' : `${Math.max(0, props.gathering.exploresCap - props.gathering.exploresUsed).toLocaleString()} explores left`}</span>}
            {territory?.isOwned && !territory.breached && <span className="sector-hud-summary">{territory.ownerLabel}</span>}
            {hunt && <button type="button" disabled={!present} onClick={onHunt}>
                {hunt.ready ? 'Fight' : 'Track'} {hunt.targetName}</button>}
            {sectorContest && <button type="button" className="sector-hud-contest"
                disabled={!present || !villageWarAdmissionOpen} onClick={onOpenSectorContest}>
                Contested · {sectorContestLabel(sectorContest.winCondition)}</button>}
            {territory?.breached && <span className="sector-hud-warning">Breached · restore HP within {territory.breachMinsLeft}m</span>}
            {territory?.rewardsSuspended && !territory.breached && <span className="sector-hud-warning">Territory rewards suspended</span>}
        </>}
        nearby={<SectorNearby sector={sector} biome={biome} players={players} present={present}
                rosterState={rosterState} action={playerAction} onAction={run} />}
        details={<>
            {present && props.quest}
            {dailyLabel && <p>{dailyLabel}</p>}
            <WorldSectorCommandPanel {...props} />
        </>} />
        <SectorRoutes sector={sector} className="sector-stage-routes" /></>;
}
