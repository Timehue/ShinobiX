import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorldSectorCanvasProps } from './WorldSectorCanvas';
import { mountContinuousWorld, STALE_WORLD_STATUS } from '../lib/continuous-world-controller';
import { WorldStandingFigure } from './WorldStandingFigure';
import { ContinuousWorldPeers } from './ContinuousWorldPeers';
import { DayNightSky } from './DayNightSky';
import { SceneAmbience } from './SceneAmbience';
import { RegionSplash } from './WorldWalkFeel';
import './continuous-world.css';
import { WorldPlayerPosition } from '../lib/world-player-position';
import { SectorNpcLayerHost } from './SectorNpcLayerHost';
import { ContinuousWorldTiles } from './ContinuousWorldTiles';
import { ResourceWorld } from './ResourceWorld';
import { SectorLife } from './SectorLife';
import { SectorBuildings } from './SectorBuildings';
import { SectorModelFigure, type SectorModelHandle } from './SectorModelFigure';
import { usePlayerGaits, useWorldModelArtBase } from '../lib/sector-obstacles';
import { useSprintStyle, isPlayerModel, starterModel } from '../lib/player-model';
import { WorldRunButton, useWorldRun } from './WorldRunButton';

/** Current normal-world view. Existing HUD/encounter components retain their owners. */
type SectorViewProps = Pick<WorldSectorCanvasProps, 'sector' | 'playerName' | 'playerTile' | 'playerAvatarImage' | 'playerModel' | 'starterWorldModel' | 'suspended' | 'paused' | 'onWorldAuthority' | 'worldMovementBlocked' | 'biome' | 'showLivePeers' | 'sharedImages' | 'sleeperPeers'> & Partial<WorldSectorCanvasProps> & {
    children?: import('react').ReactNode;
    inspectTile?: (tile: number) => void;
    space?: import('../../../shared/continuous-world-space').VersionedWorldSpace;
};
export function ContinuousWorldSector(props: SectorViewProps) {
    const canvas = useRef<HTMLCanvasElement>(null), chunk = useRef<HTMLDivElement>(null), marker = useRef<HTMLDivElement>(null);
    const latest = useRef(props), engine = useRef<Awaited<ReturnType<typeof mountContinuousWorld>> | null>(null);
    const model = useRef<SectorModelHandle>(null);
    const modelArtBase = useWorldModelArtBase(), gaits = usePlayerGaits();
    const { timers, runningUntilRef, lastRunResponseRef, onRunWindow } = useWorldRun();
    const equipped = isPlayerModel(props.playerModel) ? props.playerModel : undefined;
    const sprintStyle = useSprintStyle();
    const peerStyle = useRef(sprintStyle);
    useLayoutEffect(() => { peerStyle.current = sprintStyle; }, [sprintStyle]);
    const gaitEnabled = useRef(gaits);
    useLayoutEffect(() => { gaitEnabled.current = gaits; }, [gaits]);
    const starter = starterModel(props.playerAvatarImage, props.starterWorldModel);
    const [status, setStatus] = useState('Connecting to world…'), [retry, setRetry] = useState(0), [ready, setReady] = useState(false);
    const name = props.playerName, space = props.space;
    const position = useRef<{ sector: number; col: number; row: number } | null>(null);
    // Off the painting, the server's tile is only the nearest painted anchor; don't mark it as underfoot.
    const [onPainting, setOnPainting] = useState(true);
    useLayoutEffect(() => { latest.current = props; });
    useEffect(() => {
        const abort = new AbortController(); let alive = true;
        lastRunResponseRef.current = 0;
        runningUntilRef.current = 0;
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        void mountContinuousWorld({ space, canvas: canvas.current!, chunk: chunk.current!, marker: marker.current!, signal: abort.signal,
            gait: () => gaitEnabled.current ? performance.now() < runningUntilRef.current ? 'run' : 'walk' : undefined,
            onRunWindow, sprintStyle: () => peerStyle.current,
            // The tile the player is arriving on: its ground paints during the position round trip.
            provisional: { sector: latest.current.sector, tile: latest.current.playerTile },
            groundStride: (...args) => {
                if (!motion.matches) return model.current?.ground(...args);
                model.current?.unground();
                return undefined;
            },
            onFigure: (x, y, width, moving, gait) => model.current?.place(x, y, width, moving && !motion.matches, gait),
            paused: () => Boolean(latest.current.suspended || latest.current.paused),
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
    }, [name, retry, onRunWindow, space, runningUntilRef, lastRunResponseRef]);
    useEffect(() => { void engine.current?.externalSector(props.sector); }, [props.sector, props.suspended]);
    // Stable across renders (reads the engine ref at click time), so the memoized grid below can bail.
    const go = useCallback((sector: number, tile: number) => { engine.current?.go(sector, tile); }, []);
    return <main className={space ? "coast-sector tile-scene sector-stage-panel" : "tile-scene sector-stage-panel"}>
        {!props.suspended && props.hudLayer}
        <div className="pixel-map walkable-sector-map sector-image-map continuous-world-map" data-tile={space && props.playerTile} data-ground-floor="true" aria-busy={!ready} data-suspended={props.suspended || undefined}>
            <canvas ref={canvas} onKeyDown={event => { if (event.key === 'Enter') props.inspectTile?.(props.playerTile); }} className={props.suspended ? undefined : "world-terrain-visible"} tabIndex={0}
                aria-label="World terrain. Hold WASD or arrows to walk; tap a destination or drag to steer." />
            <DayNightSky className="on-floor" />
            {!props.suspended && !props.paused && props.ambienceBiome && props.weather && <SceneAmbience biome={props.ambienceBiome} weather={props.weather} weatherSector={props.sector} weatherBiome={props.biome} />}
            {props.regionSplash && props.onRegionSplashDone && <RegionSplash {...props.regionSplash} onDone={props.onRegionSplashDone} />}
            <div className="pixel-map continuous-world-chunk" ref={chunk} data-world-chunk={props.sector}>
                {/* A stronghold covers a suspended world: its tiles would only re-render, unseen, on every map update. */}
                {!props.suspended && props.roadExits && <ContinuousWorldTiles sector={props.sector} playerTile={props.playerTile} onPainting={onPainting} ready={ready} roadExits={props.roadExits} go={go} />}
                {props.showLivePeers && !props.suspended && <ContinuousWorldPeers space={space} sector={props.sector} selfName={props.playerName} sharedImages={props.sharedImages} sleepers={props.sleeperPeers} />}
                <SectorNpcLayerHost>
                <WorldPlayerPosition.Provider value={position}>{props.overlayLayer}{props.encounterLayer}
                    {/* Held for `ready`: the road's people and their work points are interactive, so they
                        appear once the world can be walked and tapped, not during the first-frame preview. */}
                    {!space && !props.suspended && ready && <SectorLife key={`${props.playerName}:${props.sector}`} sector={props.sector} player={props.playerName} tile={props.playerTile} biome={props.biome}
                        traces={props.lifeTraces} openReports={props.onOpenLifeTraces} onTrack={props.onLifeTrack} commit={props.onGatheringCommit} walk={(sector, tile) => engine.current?.go(sector, tile)} />}
                    {!props.suspended && ready && props.gatheringCharacter && props.onGatheringCommit && <SectorBuildings key={props.gatheringCharacter.name} character={props.gatheringCharacter} sector={props.sector} tile={props.playerTile} commit={props.onGatheringCommit} onAtlas={props.onOpenAtlas} walk={(sector,tile)=>engine.current?.go(sector,tile)} />}
                </WorldPlayerPosition.Provider>
                </SectorNpcLayerHost>
                {!props.suspended && props.gatheringCharacter && props.onGatheringCommit && <ResourceWorld character={props.gatheringCharacter} sector={props.sector} tile={props.playerTile} commit={props.onGatheringCommit} walk={(sector, tile) => { engine.current?.go(sector, tile); }} worldBossCrystals={props.worldBossCrystals} onContest={props.onContestResource} />}
            </div>
            <div ref={marker} className="sector-avatar-figure continuous-world-self" aria-hidden="true" data-world-self="true">
                {gaits && modelArtBase && <SectorModelFigure ref={model} kind={starter} accountName={name} equipped={equipped}
                    style={sprintStyle} artBase={modelArtBase} self />}
                <span className="sector-avatar-shadow" /><span className="sector-avatar-sprite"><span className="sector-avatar-body">
                    <WorldStandingFigure kind={starter} accountName={name} />
                </span></span>
                {gaits && modelArtBase && <span className="sector-peer-label sector-self-label">{name}</span>}
            </div>
            {gaits && ready && !props.suspended && !props.paused && <WorldRunButton timers={timers} onWindow={onRunWindow} />}
            {props.mapHudLayer}
            <div className="continuous-world-status" role="status" aria-live="polite" data-connecting={status === 'Connecting to world…' || undefined}>{status}
                {status === STALE_WORLD_STATUS ? <button type="button" onClick={() => window.location.reload()}>Reload</button>
                    : !ready && status !== 'Connecting to world…' && <button type="button" onClick={() => { setStatus('Connecting to world…'); setRetry(value => value + 1); }}>Retry</button>}
            </div>
        </div>
        {props.children}
    </main>;
}
