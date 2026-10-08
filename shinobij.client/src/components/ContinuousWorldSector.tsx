import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorldSectorCanvasProps } from './WorldSectorCanvas';
import { mountContinuousWorld, STALE_WORLD_STATUS } from '../lib/continuous-world-controller';
import { SectorPortrait } from './SectorPortrait';
import { ContinuousWorldPeers } from './ContinuousWorldPeers';
import { DayNightSky } from './DayNightSky';
import { SceneAmbience } from './SceneAmbience';
import { RegionSplash } from './WorldWalkFeel';
import './continuous-world.css';
import { WorldPlayerPosition } from '../lib/world-player-position';
import { sectorName } from '../../../shared/sector-geo';
import { isWalkableTile } from '../../../shared/sector-walk-mask';

/** Current normal-world view. Existing HUD/encounter components retain their owners. */
export function ContinuousWorldSector(props: WorldSectorCanvasProps) {
    const canvas = useRef<HTMLCanvasElement>(null), chunk = useRef<HTMLDivElement>(null), marker = useRef<HTMLDivElement>(null);
    const latest = useRef(props), engine = useRef<Awaited<ReturnType<typeof mountContinuousWorld>> | null>(null);
    const [status, setStatus] = useState('Connecting to world…'), [retry, setRetry] = useState(0), [ready, setReady] = useState(false);
    const name = props.playerName;
    const position = useRef<{ sector: number; col: number; row: number } | null>(null);
    // Off the painting, the server's tile is only the nearest painted anchor; don't mark it as underfoot.
    const [onPainting, setOnPainting] = useState(true);
    useLayoutEffect(() => { latest.current = props; });
    useEffect(() => {
        const abort = new AbortController(); let alive = true;
        void mountContinuousWorld({ canvas: canvas.current!, chunk: chunk.current!, marker: marker.current!, signal: abort.signal,
            blocked: () => Boolean(latest.current.suspended || latest.current.worldMovementBlocked?.()
                || document.querySelector('[aria-modal=true],dialog[open]')),
            onAuthority: (sector, tile) => latest.current.onWorldAuthority?.(sector, tile), onStatus: setStatus,
            onPosition: (sector, col, row) => {
                position.current = { sector, col, row };
                setOnPainting(col > -.5 && col < 11.5 && row > -.5 && row < 11.5);
            },
            // The painted building is the landmark, even where its overlay button is not under the tap.
            onTapTile: tile => {
                const landmark = chunk.current?.querySelector<HTMLButtonElement>(`[data-footprint~="${tile}"]:not(:disabled)`);
                landmark?.click(); return Boolean(landmark);
            },
        }).then(value => { if (!alive) { value.dispose(); return; } engine.current = value; value.externalSector(latest.current.sector); setStatus(''); setReady(true); })
            .catch(error => { if (alive && !abort.signal.aborted) setStatus(error instanceof Error ? error.message : 'World connection unavailable.'); });
        return () => { alive = false; abort.abort(); engine.current?.dispose(); engine.current = null; };
    }, [name, retry]);
    useEffect(() => { void engine.current?.externalSector(props.sector); }, [props.sector, props.suspended]);
    return <main className="tile-scene sector-stage-panel">
        {!props.suspended && props.hudLayer}
        <div className="pixel-map walkable-sector-map sector-image-map continuous-world-map" data-ground-floor="true" aria-busy={!ready}>
            <canvas ref={canvas} tabIndex={0} aria-label="World terrain. Hold WASD or arrows to walk; tap a destination or drag to steer." />
            <DayNightSky className="on-floor" />
            <SceneAmbience biome={props.ambienceBiome} weather={props.weather} weatherSector={props.sector} weatherBiome={props.biome} />
            {props.regionSplash && <RegionSplash {...props.regionSplash} onDone={props.onRegionSplashDone} />}
            <div className="pixel-map continuous-world-chunk" ref={chunk} data-world-chunk={props.sector}>
                {Array.from({ length: 144 }, (_, tile) => <button key={tile} type="button" tabIndex={tile === props.playerTile ? 0 : -1}
                    className={`scene-tile continuous-world-tile${tile === props.playerTile && onPainting ? ' sector-player-tile' : ''}`}
                    disabled={!ready} aria-label={props.roadExits.some(e => e.tile === tile)
                        ? `Cross to ${sectorName(props.roadExits.find(e => e.tile === tile)!.destinationSector)}`
                        : `${tile === props.playerTile ? 'Current tile' : isWalkableTile(props.sector, tile) ? 'Move to tile' : 'Move near blocked tile'} row ${Math.floor(tile / 12) + 1} column ${tile % 12 + 1}`}
                    onClick={() => {
                        const exit = props.roadExits.find(e => e.tile === tile);
                        engine.current?.go(exit?.destinationSector ?? props.sector, exit?.destinationTile ?? tile);
                    }} />)}
                {props.showLivePeers && <ContinuousWorldPeers sector={props.sector} selfName={props.playerName} sharedImages={props.sharedImages} />}
                <WorldPlayerPosition.Provider value={position}>{props.overlayLayer}{props.encounterLayer}</WorldPlayerPosition.Provider>
            </div>
            <div ref={marker} className="sector-avatar-figure continuous-world-self" aria-hidden="true" data-world-self="true">
                <span className="sector-avatar-shadow" /><span className="sector-avatar-sprite"><span className="sector-avatar-body">
                    <SectorPortrait key={props.playerAvatarImage} src={props.playerAvatarImage} name={props.playerName} /><span className="sector-avatar-pin" />
                </span></span>
            </div>
            {props.mapHudLayer}
            <div className="continuous-world-status" role="status" aria-live="polite">{status}
                {status === STALE_WORLD_STATUS ? <button type="button" onClick={() => window.location.reload()}>Reload</button>
                    : !ready && status !== 'Connecting to world…' && <button type="button" onClick={() => { setStatus('Connecting to world…'); setRetry(value => value + 1); }}>Retry</button>}
            </div>
        </div>
    </main>;
}
