import { nearestWalkableTile, sectorWalkMask, walkPath } from "../../../shared/sector-walk-mask";
import { sectorObstaclesOn } from "./sector-obstacles";
type Position = { col: number; row: number };
/** Keep a partial cardinal leg intact when a moving destination changes. */
export function createSectorNavigator() {
    let route: number[] = [], destination = -1, board = -1;
    return (sector: number, position: Position, target: Position): Position => {
        if (!sectorWalkMask(sector, sectorObstaclesOn())) { route = []; destination = -1; return target; }
        const to = nearestWalkableTile(sector, Math.round(target.row) * 12 + Math.round(target.col), sectorObstaclesOn());
        if (destination !== to || board !== sector || !route.length) {
            const from = nearestWalkableTile(sector, Math.round(position.row) * 12 + Math.round(position.col), sectorObstaclesOn());
            route = walkPath(sector, from, to, sectorObstaclesOn()) ?? [from];
            destination = to; board = sector;
        }
        while (route.length > 1 && Math.hypot(route[0]! % 12 - position.col, Math.floor(route[0]! / 12) - position.row) < .02) route.shift();
        const tile = route[0]!;
        return { col: tile % 12, row: Math.floor(tile / 12) };
    };
}
