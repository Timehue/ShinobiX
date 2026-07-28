import * as THREE from "three";

export type PetModelPresentationBounds = Readonly<{
    /** Exact sampled bounds, retained as a safe fallback and diagnostic. */
    raw: THREE.Box3;
    /** Central visible-mass envelope used for presentation scale and centering. */
    fit: THREE.Box3;
    /** Sparse tips cannot lift the creature; meaningful low geometry still plants it. */
    groundY: number;
}>;

const FIT_LOW = 0.02;
const FIT_HIGH = 0.98;
const GROUND_LOW = 0.005;
const MIN_ROBUST_SAMPLES = 128;
const MAX_SAMPLES_PER_MESH = 24_000;
const MIN_DEFORM_RATIO = 0.08;
const MAX_DEFORM_RATIO = 12;

function percentile(sorted: readonly number[], ratio: number): number {
    if (!sorted.length) return 0;
    const position = Math.max(0, Math.min(1, ratio)) * (sorted.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return THREE.MathUtils.lerp(sorted[lower], sorted[upper], position - lower);
}

/**
 * Measures creature vertices rather than trusting raw Box3 extrema.
 *
 * Generated animal GLBs can contain a few proxy/cage vertices far outside the
 * visible body, while legitimate wings and tails also create sparse extrema.
 * A central percentile envelope therefore owns scale and horizontal centering,
 * and a more conservative lower percentile owns floor contact. The complete
 * mesh still renders; this only prevents sparse geometry from shrinking or
 * levitating the animal's readable mass.
 */
export function petModelPresentationBounds(root: THREE.Object3D, deformed = false): PetModelPresentationBounds {
    const raw = new THREE.Box3();
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const point = new THREE.Vector3();

    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const position = node.geometry.getAttribute("position");
        if (!position?.count) return;
        const stride = Math.max(1, Math.ceil(position.count / MAX_SAMPLES_PER_MESH));
        for (let index = 0; index < position.count; index += stride) {
            if (deformed && node instanceof THREE.SkinnedMesh) node.getVertexPosition(index, point);
            else point.set(position.getX(index), position.getY(index), position.getZ(index));
            point.applyMatrix4(node.matrixWorld);
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
            raw.expandByPoint(point);
            xs.push(point.x);
            ys.push(point.y);
            zs.push(point.z);
        }
    });

    if (raw.isEmpty()) {
        const zero = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
        return { raw: zero.clone(), fit: zero, groundY: 0 };
    }
    if (ys.length < MIN_ROBUST_SAMPLES) {
        return { raw, fit: raw.clone(), groundY: raw.min.y };
    }

    xs.sort((left, right) => left - right);
    ys.sort((left, right) => left - right);
    zs.sort((left, right) => left - right);
    const fit = new THREE.Box3(
        new THREE.Vector3(percentile(xs, FIT_LOW), percentile(ys, FIT_LOW), percentile(zs, FIT_LOW)),
        new THREE.Vector3(percentile(xs, FIT_HIGH), percentile(ys, FIT_HIGH), percentile(zs, FIT_HIGH)),
    );
    const groundY = Math.min(fit.min.y, percentile(ys, GROUND_LOW));
    return { raw, fit, groundY };
}

/**
 * Prefers the actual skinned creature while rejecting broken armature-space
 * calculations. A handful of legacy FBX-derived rigs expand roughly 100× when
 * skinning is evaluated; their stable bind-pose percentile envelope remains the
 * correct fallback.
 */
export function stablePetModelPresentationBounds(root: THREE.Object3D): PetModelPresentationBounds {
    const bind = petModelPresentationBounds(root, false);
    const deformed = petModelPresentationBounds(root, true);
    const bindLongest = Math.max(...bind.fit.getSize(new THREE.Vector3()).toArray());
    const deformedLongest = Math.max(...deformed.fit.getSize(new THREE.Vector3()).toArray());
    const ratio = deformedLongest / Math.max(0.001, bindLongest);
    return Number.isFinite(ratio) && ratio >= MIN_DEFORM_RATIO && ratio <= MAX_DEFORM_RATIO ? deformed : bind;
}
