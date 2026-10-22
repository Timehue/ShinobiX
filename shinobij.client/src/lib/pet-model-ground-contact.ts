import * as THREE from 'three';

/** A bounded skin sample used only during collapse, after the mixer and body
 * accents. Ground the visible mass rather than an imported skeleton's origin. */
export function petModelGroundY(surface: THREE.Object3D, exact: boolean | 1 = false): number | null {
    surface.updateWorldMatrix(true, true);
    surface.updateMatrixWorld(true);
    const heights: number[] = [], point = new THREE.Vector3();
    surface.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        if (node instanceof THREE.SkinnedMesh) node.skeleton.update();
        const positions = node.geometry.getAttribute('position');
        if (!positions) return;
        const stride = exact ? 1 : Math.max(1, Math.ceil(positions.count / 512));
        for (let i = 0; i < positions.count; i += stride) {
            node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld);
            if (Number.isFinite(point.y)) heights.push(point.y);
        }
    });
    if (!heights.length) return null;
    heights.sort((a, b) => a - b);
    return heights[exact ? 0 : Math.floor((heights.length - 1) * .005)];
}
