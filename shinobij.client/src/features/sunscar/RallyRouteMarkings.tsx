import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { rallyLanePosition } from '../../../../shared/sunscar/rally-tracks';
import type { RallyTrack } from '../../../../shared/sunscar/rally-types';
import { rallyRoadHalfWidth } from './rally-layout';

/** One static mesh for lane guides and shape-coded road warnings. */
export function RallyRouteMarkings({ track }: { track: RallyTrack }) {
    const geometry = useMemo(() => {
        const positions: number[] = [], colors: number[] = [];
        const color = new THREE.Color();
        const stroke = (x1: number, d1: number, x2: number, d2: number, width: number, tint: string) => {
            const a = rallyLanePosition(track, d1, x1), b = rallyLanePosition(track, d2, x2);
            const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
            const ox = -dz / length * width / 2, oz = dx / length * width / 2;
            const corners = [[a.x - ox, a.y + .035, a.z - oz], [a.x + ox, a.y + .035, a.z + oz],
                [b.x - ox, b.y + .035, b.z - oz], [b.x + ox, b.y + .035, b.z + oz]];
            color.set(tint);
            for (const i of [0, 1, 2, 1, 3, 2]) { positions.push(...corners[i]); colors.push(color.r, color.g, color.b); }
        };
        for (let d = 4; d < track.length; d += 8) for (const x of [-1.325, 1.325]) stroke(x, d, x, Math.min(track.length, d + 5), .11, '#f5dfb5');
        for (let d = 0; d < track.length; d += 4) {
            const end = Math.min(track.length, d + 3.3);
            for (const side of [-1, 1]) stroke(side * (rallyRoadHalfWidth(track, d) - .22), d,
                side * (rallyRoadHalfWidth(track, end) - .22), end, .13, track.palette.accent);
        }
        for (const obstacle of track.obstacles) {
            const x = obstacle.lane * 2.65, d = obstacle.at;
            const shortcut = obstacle.kind === 'shortcut' || obstacle.kind === 'ramp';
            if (shortcut) {
                if (obstacle.kind === 'ramp') continue;
                for (const offset of [24, 18, 12, 6]) {
                    stroke(x - .5, d - offset - 1, x, d - offset, .16, '#63f0bb');
                    stroke(x + .5, d - offset - 1, x, d - offset, .16, '#63f0bb');
                }
            } else if (obstacle.height > 1.6) {
                stroke(x - .55, d - 9, x + .55, d - 7, .2, '#ff947e');
                stroke(x + .55, d - 9, x - .55, d - 7, .2, '#ff947e');
            } else {
                stroke(x - .65, d - 8, x, d - 6.5, .2, '#ffdf87');
                stroke(x + .65, d - 8, x, d - 6.5, .2, '#ffdf87');
            }
        }
        const result = new THREE.BufferGeometry();
        result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        return result;
    }, [track]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    return <mesh geometry={geometry}><meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent opacity={.72} depthWrite={false}/></mesh>;
}
