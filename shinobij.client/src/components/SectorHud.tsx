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
import { SectorChat } from './SectorChat';
import { SectorHudPanel } from './SectorHudPanel';
import { WorldSectorCommandPanel } from './WorldSectorCommandPanel';
import type { WorldSectorCommandPanelProps } from './WorldSectorCommandPanel.types';
import '../styles/sector-hud.css';

export function SectorHud(props: WorldSectorCommandPanelProps & {
    rosterState: SectorRosterState; playerAction: SectorPlayerActionState;
    onPlayerAction: (key: string, sector: number, intent: SectorPlayerIntent, originCurrent?: () => boolean) => void;
    /** The viewer's character name, so sector chat can tell their own lines apart. */
    chatName?: string;
}) {
    const { sector, present, biome, players, hunt, territory, sectorContest, chatName = '',
        rosterState, playerAction, onPlayerAction, onExplore, onFindRicherGround,
        onHunt, onOpenSectorContest, villageWarAdmissionOpen } = props;
    // One sheet over the board at a time: Sector Info, or sector chat when the
    // nearby column is too short to hold it docked.
    const [sheet, setSheet] = useState<'info' | 'chat' | null>(null);
    const open = sheet === 'info';
    const setOpen = (next: boolean) => setSheet(next ? 'info' : null);
    const setChatSheet = (next: boolean) => setSheet(current => next ? 'chat' : current === 'chat' ? null : current);
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
    const dailyExplores = props.dailyExplores;
    const dailyCapped = (dailyExplores ?? 0) >= 100;
    const close = (restore = false, touch = false) => {
        if (touch) consumeTouchClick();
        setOpen(false); if (restore) triggerRef.current?.focus({ preventScroll: true });
    };
    return <><div className="sector-hud" ref={rootRef} data-sector-hud=""
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
        onKeyUp={event => event.stopPropagation()}>
        <div className="sector-hud-top">
            <SectorHudIdentity sector={sector} present={present} biome={biome} />
            <div className="sector-hud-controls" aria-label="Sector actions">
                <button type="button" className="sector-hud-explore" data-sector-explore=""
                    aria-label={gatherDepleted ? 'Find richer ground' : 'Explore'}
                    aria-describedby={dailyCapped && !gatherDepleted ? `${id}-daily-exploration` : undefined}
                    disabled={!gatherDepleted && (!present || dailyCapped || props.exploreBusy)} onClick={gatherDepleted ? onFindRicherGround : onExplore}>
                    <span>{gatherDepleted ? 'Find richer ground' : 'Explore'}</span>
                    <small aria-hidden="true">{gatherDepleted ? 'Follow a richer trail' : dailyCapped ? 'Daily limit reached' : props.exploreBusy ? 'Exploring...' : 'Search this sector'}</small></button>
                <button type="button" ref={triggerRef} className={`sector-hud-info${open ? ' is-open' : ''}`}
                    aria-label={`Sector Info${props.contract?.claimable ? ' · Claim ready' : ''}`}
                    aria-expanded={open} aria-controls={`${id}-info`} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
                    <span>Sector Info{props.contract?.claimable && <small>Claim ready</small>}</span>
                    <span className="sector-hud-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
                </button>
            </div>
        </div>
        <div className="sector-hud-context">
            {dailyExplores !== undefined && <span id={`${id}-daily-exploration`} className="sector-hud-summary">Your daily exploration: {dailyExplores}/100{dailyCapped ? ' · Resets at midnight UTC' : ''}</span>}
            {props.gathering?.hydrated && <span className="sector-hud-summary">Shared sector pool: {gatherDepleted ? 'Gathering depleted' : `${Math.max(0, props.gathering.exploresCap - props.gathering.exploresUsed).toLocaleString()} explores left`}</span>}
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
            <SectorNearby sector={sector} biome={biome} players={players} present={present}
                rosterState={rosterState} action={playerAction} onAction={run} />
            <SectorChat sector={sector} present={present} playerName={chatName} hudRef={rootRef}
                sheetOpen={sheet === 'chat'} onSheet={setChatSheet} />
        </section>
        {open && <SectorHudPanel id={`${id}-info`} rootRef={rootRef} onClose={close} title="Sector Info">
            <WorldSectorCommandPanel {...props} />
        </SectorHudPanel>}
    </div><SectorRoutes sector={sector} className="sector-stage-routes" /></>;
}
