import type { WorldSectorRiftMarker, WorldSectorVaultMarker, WorldSectorShrineMarker } from "./WorldSectorOverlayLayer";
import { sectorFloorLayout, sectorSiteImage } from "../lib/sector-floor-layout";
import { shrineForSector } from "../../../shared/shrines";
import { openBuildingCounter } from '../lib/sector-building-counter';

/** Regional painted cutouts occupy authored footprints; small persistent names identify their use. */
export function SectorGroundLandmarks({ sector, rift, vault, shrine, onOpenShrine, fieldPointId }: {
    sector: number; rift: WorldSectorRiftMarker | null; vault: WorldSectorVaultMarker | null;
    shrine: WorldSectorShrineMarker | null; onOpenShrine: () => void;
    fieldPointId?: string;
}) {
    const layout = sectorFloorLayout(sector);
    if (!layout) return null;
    const shrineDef = shrine?.definition ?? shrineForSector(sector);
    const entries = [
        { kind: "stronghold" as const, name: vault?.obsidian ? "Obsidian Stronghold" : "Stronghold",
            title: vault ? `${vault.village} Sector Stronghold — ${vault.defending ? 'defend' : 'infiltrate'}` : "Sector Stronghold",
            onOpen: vault?.onOpen },
        ...(rift ? [{ kind: "rift" as const, name: "Quest Rift",
            title: rift.title, onOpen: rift.onOpen }] : []),
        ...(shrineDef ? [{ kind: "shrine" as const, name: shrineDef.name, title: `${shrineDef.name} — make an offering`, onOpen: shrine ? onOpenShrine : undefined }] : []),
    ];
    return <>{entries.map(entry => {
        const site = layout.sites[entry.kind];
        if (!site) return null;
        const [left, top, size] = site.footprint;
        const footprint = Array.from({ length: size! * size! }, (_, k) => (top! + Math.floor(k / size!)) * 12 + left! + k % size!).join(" ");
        return <button type="button" key={entry.kind} data-footprint={footprint}
            className={`sector-ground-landmark sector-ground-${entry.kind}${entry.kind === "shrine" ? ` shrine-tier-${shrine?.tier ?? 0}` : ""} is-active`}
            style={{ left: `${site.left}%`, top: `${site.top}%`, width: `${site.width}%` }}
            title={entry.title} aria-label={entry.title} onClick={entry.kind === 'rift' ? entry.onOpen : () => openBuildingCounter({
                buildingId: entry.kind === 'stronghold' ? `stronghold-${sector}` : `shrine-${shrineDef?.id}`,
                entrance:{sector,tile:site.approach},
                interior: entry.onOpen, interiorLabel: entry.kind === 'shrine' ? 'Make an offering' : 'Enter the stronghold',
                restriction: entry.onOpen ? undefined : entry.kind === 'stronghold' ? 'The public counter is open. Interior admission depends on your level, current war duty and stronghold availability.' : 'The keeper’s register is open. Offerings are currently unavailable.',
            })}>
            {(!layout.bakedLandmarks || entry.kind === "rift") && <img src={sectorSiteImage(sector, entry.kind)} alt="" draggable={false} />}
            <span className="sector-ground-landmark-label">{entry.name}</span>
        </button>;
    })}{!layout.bakedLandmarks && layout.sites.cairn && fieldPointId !== layout.cairnId && <img
        className="sector-ground-cairn" src="/landmarks/signal-cairn-v1.webp" alt="Signal cairn"
        style={{ left: `${layout.sites.cairn.left}%`, top: `${layout.sites.cairn.top}%`, width: `${layout.sites.cairn.width}%` }}
        draggable={false} />}</>;
}
