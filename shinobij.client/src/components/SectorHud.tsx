import { useId, useLayoutEffect, useRef, useState } from 'react';
import { sectorGatherLineFor } from '../lib/sector-pool';
import { sectorContestLabel } from '../lib/sector-war-engagement';
import type { SectorPlayerActionState, SectorPlayerIntent } from '../lib/use-sector-player-action';
import type { SectorRosterState } from '../lib/presence-store';
import { useSectorHudLayout } from '../lib/use-sector-hud-layout';
import { useDismissGesture } from '../lib/use-dismiss-gesture';
import { SectorHudIdentity } from './SectorHudIdentity';
import { SectorNearby } from './SectorNearby';
import { SectorRoutes } from './SectorRoutes';
import { SectorHudPanel } from './SectorHudPanel';
import { WorldSectorCommandPanel } from './WorldSectorCommandPanel';
import type { WorldSectorCommandPanelProps } from './WorldSectorCommandPanel.types';
import '../styles/sector-hud.css';

export function SectorHud(props: WorldSectorCommandPanelProps & {
    rosterState: SectorRosterState; playerAction: SectorPlayerActionState;
    onPlayerAction: (key: string, sector: number, intent: SectorPlayerIntent, originCurrent?: () => boolean) => void;
}) {
    const { sector, present, biome, weather, players, hunt, territory, sectorContest,
        rosterState, playerAction, onPlayerAction, onExplore, onFindRicherGround,
        onHunt, onOpenSectorContest, villageWarAdmissionOpen } = props;
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    useSectorHudLayout(rootRef);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const id = useId();
    const originVersion = useRef(0);
    // Closing this HUD retires read-only navigation, even if WorldMap stays mounted.
    useLayoutEffect(() => () => { originVersion.current += 1; }, []);
    const run = (key: string, fromSector: number, intent: SectorPlayerIntent) => {
        const version = originVersion.current;
        onPlayerAction(key, fromSector, intent, () => originVersion.current === version);
    };
    const consumeTouchClick = useDismissGesture();
    const gatherDepleted = sectorGatherLineFor(props.gathering)?.depleted === true;
    const close = (restore = false, touch = false) => {
        if (touch) consumeTouchClick();
        setOpen(false); if (restore) triggerRef.current?.focus({ preventScroll: true });
    };
    return <><div className="sector-hud" ref={rootRef} data-sector-hud=""
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
        onKeyUp={event => event.stopPropagation()}>
        <div className="sector-hud-top">
            <SectorHudIdentity sector={sector} present={present} biome={biome} weather={weather} />
            <div className="sector-hud-controls" aria-label="Sector actions">
                <button type="button" className="sector-hud-explore" data-sector-explore=""
                    aria-label={gatherDepleted ? 'Find richer ground' : 'Explore'}
                    disabled={!present && !gatherDepleted} onClick={gatherDepleted ? onFindRicherGround : onExplore}>
                    <span>{gatherDepleted ? 'Find richer ground' : 'Explore'}</span>
                    <small aria-hidden="true">{gatherDepleted ? 'Follow a richer trail' : 'Search this sector'}</small></button>
                <button type="button" ref={triggerRef} className={`sector-hud-info${open ? ' is-open' : ''}`}
                    aria-label={`Sector Info${props.contract?.claimable ? ' · Claim ready' : ''}`}
                    aria-expanded={open} aria-controls={`${id}-info`} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
                    <span>Sector Info{props.contract?.claimable && <small>Claim ready</small>}</span>
                    <span className="sector-hud-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
                </button>
            </div>
        </div>
        <div className="sector-hud-context">
            {props.gathering?.hydrated && <span className="sector-hud-summary">{gatherDepleted ? 'Gathering depleted' : `${Math.max(0, props.gathering.exploresCap - props.gathering.exploresUsed).toLocaleString()} explores left`}</span>}
            {territory?.isOwned && !territory.breached && <span className="sector-hud-summary">{territory.ownerLabel}</span>}
            {hunt && <button type="button" disabled={!present} onClick={onHunt}>
                {hunt.ready ? 'Fight' : 'Track'} {hunt.targetName}</button>}
            {sectorContest && <button type="button" className="sector-hud-contest"
                disabled={!present || !villageWarAdmissionOpen} onClick={onOpenSectorContest}>
                Contested · {sectorContestLabel(sectorContest.winCondition)}</button>}
            {territory?.breached && <span className="sector-hud-warning">Breached · restore HP within {territory.breachMinsLeft}m</span>}
            {territory?.rewardsSuspended && !territory.breached && <span className="sector-hud-warning">Territory rewards suspended</span>}
        </div>
        <section className="sector-nearby" aria-label="Nearby players">
            <SectorNearby sector={sector} biome={biome} weather={weather} players={players} present={present}
                rosterState={rosterState} action={playerAction} onAction={run} />
        </section>
        {open && <SectorHudPanel id={`${id}-info`} rootRef={rootRef} onClose={close} title="Sector Info">
            <WorldSectorCommandPanel {...props} />
        </SectorHudPanel>}
    </div><SectorRoutes sector={sector} className="sector-stage-routes" /></>;
}
