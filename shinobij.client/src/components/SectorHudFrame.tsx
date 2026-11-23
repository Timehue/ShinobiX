import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { useSectorHudLayout } from '../lib/use-sector-hud-layout';
import { useDismissGesture } from '../lib/use-dismiss-gesture';
import { SectorHudIdentity } from './SectorHudIdentity';
import { SectorChat } from './SectorChat';
import { SectorHudPanel } from './SectorHudPanel';
import type { Biome } from '../types/core';
import '../styles/sector-hud.css';

type Props = {
    sector: number; present: boolean; biome: Biome; chatName: string;
    weather?: ReactNode; name?: string; region?: string; claimable?: boolean; questHere?: boolean;
    explore: ReactNode; context?: ReactNode; nearby: ReactNode; details: ReactNode;
};
export function SectorHudFrame({ sector, present, chatName, claimable, questHere, explore, context, nearby, details, ...identity }: Props) {
    // Mobile info expands into the scrollable page; desktop uses a sheet.
    const [sheet, setSheet] = useState<'info' | 'chat' | null>(null);
    // The HUD stays mounted across sectors (remounting it was the crossing's
    // longest task), so what a remount reset is reset here: an open sheet closes.
    const [sheetSector, setSheetSector] = useState(sector);
    if (sheetSector !== sector) { setSheetSector(sector); setSheet(null); }
    const open = sheet === 'info';
    const setOpen = (next: boolean) => setSheet(next ? 'info' : null);
    // Stable, so the memoised chat skips the HUD's re-renders (it only calls setSheet).
    const setChatSheet = useCallback((next: boolean) => setSheet(current => next ? 'chat' : current === 'chat' ? null : current), []);
    const rootRef = useRef<HTMLDivElement>(null);
    const compact = useSectorHudLayout(rootRef);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const id = useId();
    const consumeTouchClick = useDismissGesture();
    const close = (restore = false, touch = false) => {
        if (touch) consumeTouchClick();
        setSheet(null);
        if (restore) triggerRef.current?.focus({ preventScroll: true });
    };
    return <div className="sector-hud" ref={rootRef} data-sector-hud=""
        onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()} onKeyDown={event => {
            if (compact && open && event.key === 'Escape') { event.preventDefault(); close(true); }
            event.stopPropagation();
        }}
        onKeyUp={event => event.stopPropagation()}>
        {compact && <p className="sector-hud-scroll-cue">Scroll down for sector details <span aria-hidden="true">↓</span></p>}
        <div className="sector-hud-top">
            <SectorHudIdentity sector={sector} present={present} {...identity} />
            <div className="sector-hud-controls" aria-label="Sector actions">
                {explore}
                <button type="button" ref={triggerRef} className={`sector-hud-info${open ? ' is-open' : ''}`}
                    aria-label={`Sector info${claimable ? ' · Claim ready' : ''}`}
                    aria-expanded={open} aria-controls={`${id}-info`} aria-haspopup={compact ? undefined : 'dialog'} onClick={() => setOpen(!open)}>
                    <span>Sector info{claimable && <small>Claim ready</small>}</span>
                    <span className="sector-hud-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
                </button>
            </div>
        </div>
        <div className="sector-hud-context">
            {context}
            {questHere && present && <button type="button" onClick={() => setOpen(true)}>Quest step here</button>}
        </div>
        {compact && open && <section id={`${id}-info`} className="sector-hud-inline-info" aria-labelledby={`${id}-info-title`}>
            <header className="sector-hud-panel-heading">
                <strong id={`${id}-info-title`}>Sector Info</strong>
                <button type="button" aria-label="Close Sector Info" onClick={() => close(true)}>×</button>
            </header>
            {details}
        </section>}
        <section className="sector-nearby" aria-label="Nearby players">
            {nearby}
            <SectorChat key={sector} sector={sector} present={present} playerName={chatName} hudRef={rootRef}
                sheetOpen={sheet === 'chat'} onSheet={setChatSheet} inline={compact} />
        </section>
        {!compact && open && <SectorHudPanel id={`${id}-info`} rootRef={rootRef} onClose={close} title="Sector Info">
            {details}
        </SectorHudPanel>}
    </div>;
}
