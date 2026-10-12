import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute } from 'three';

/** Fade the weakest retained influence to zero at a fourth/fifth-place tie.
 * Hard top-four truncation changes bone palettes abruptly along a smooth
 * surface. Subtracting the fifth weight keeps that palette boundary continuous. */
export function packContinuousPetSkinWeights(values: ArrayLike<number>) {
    const joints = Array.from({ length: values.length }, (_, j) => j).sort((a, b) => values[b] - values[a]).slice(0, 5);
    const floor = joints.length > 4 ? values[joints[4]] : 0;
    joints.length = Math.min(joints.length, 4);
    const weights = joints.map(j => Math.max(0, values[j] - floor));
    const total = weights.reduce((sum, value) => sum + value, 0);
    return { joints, weights: weights.map((value, i) => total > 1e-12 ? value / total : i === 0 ? 1 : 0) };
}

function connectedUvSeamPairs(source: BufferGeometry) {
    const position = source.getAttribute('position'), index = source.index!;
    const groups = new Map<string, { id: number; vertices: number[] }>(), vertexGroups = new Uint32Array(position.count);
    for (let v = 0; v < position.count; v++) {
        const key = [position.getX(v), position.getY(v), position.getZ(v)].map(value => Math.round(value * 1e6)).join(',');
        if (!groups.has(key)) groups.set(key, { id: groups.size, vertices: [] });
        const group = groups.get(key)!; group.vertices.push(v); vertexGroups[v] = group.id;
    }
    const neighbors = new Map<number, Set<number>>();
    for (const group of groups.values()) if (group.vertices.length > 1) for (const v of group.vertices) neighbors.set(v, new Set());
    for (let i = 0; i < index.count; i += 3) {
        const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        for (const v of triangle) if (neighbors.has(v)) for (const n of triangle) if (vertexGroups[v] !== vertexGroups[n]) neighbors.get(v)!.add(vertexGroups[n]);
    }
    const pairs = new Map<string, [number, number]>();
    for (const group of groups.values()) if (group.vertices.length > 1) {
        const adjacent = new Map<number, number>();
        for (const v of group.vertices) for (const n of neighbors.get(v)!) {
            if (!adjacent.has(n)) adjacent.set(n, v);
            const other = adjacent.get(n)!;
            if (other !== v) pairs.set(`${Math.min(v, other)},${Math.max(v, other)}`, [v, other]);
        }
    }
    return [...pairs.values()];
}

/** Diffuse abrupt automatic binding boundaries over the connected surface.
 * UV duplicates are welded for this calculation only. Mesh positions, normals,
 * topology and rigid skull details remain unchanged. Diffusion follows
 * triangle connectivity after coincident-position welding. */
export function repairPetSkinWeights(source: BufferGeometry, jointCount: number, headJoint = -1, iterations = 48, seamPairs?: readonly (readonly number[])[]) {
    const position = source.getAttribute('position'), index = source.index;
    const skinIndex = source.getAttribute('skinIndex'), skinWeight = source.getAttribute('skinWeight');
    if (!position || !index || !skinIndex || !skinWeight || jointCount < 2) return null;
    const vertexToGroup = new Uint32Array(position.count), welded = new Map<string, number>();
    const members: number[][] = [], neighbors: Set<number>[] = [];
    for (let v = 0; v < position.count; v++) {
        const key = [position.getX(v), position.getY(v), position.getZ(v)].map(x => Math.round(x * 1e6)).join(',');
        let group = welded.get(key);
        if (group === undefined) { group = members.length; welded.set(key, group); members.push([]); neighbors.push(new Set()); }
        vertexToGroup[v] = group; members[group].push(v);
    }
    for (let i = 0; i < index.count; i += 3) {
        const a = vertexToGroup[index.getX(i)], b = vertexToGroup[index.getX(i + 1)], c = vertexToGroup[index.getX(i + 2)];
        for (const [from, to] of [[a, b], [b, c], [c, a]]) if (from !== to) { neighbors[from].add(to); neighbors[to].add(from); }
    }
    let values = new Float32Array(members.length * jointCount);
    const locked = new Uint8Array(members.length);
    for (let g = 0; g < members.length; g++) {
        for (const v of members[g]) for (let slot = 0; slot < 4; slot++) values[g * jointCount + skinIndex.getComponent(v, slot)] += skinWeight.getComponent(v, slot) / members[g].length;
        locked[g] = headJoint >= 0 && members[g].some(v => Array.from({ length: 4 }, (_, slot) => skinIndex.getComponent(v, slot) === headJoint ? skinWeight.getComponent(v, slot) : 0).reduce((sum, weight) => sum + weight, 0) > .999) ? 1 : 0;
        if (locked[g]) { for (let j = 0; j < jointCount; j++) values[g * jointCount + j] = j === headJoint ? 1 : 0; }
    }
    // Smooth only neighborhoods of a discontinuous binding. Constant-weight
    // interiors and the large majority of vertices do not need a repair.
    const affected = new Uint8Array(members.length);
    if (seamPairs) for (const pair of seamPairs) for (const vertex of pair) affected[vertexToGroup[vertex]] = 1;
    else for (let g = 0; g < members.length; g++) for (const n of neighbors[g]) {
        let difference = 0;
        for (let j = 0; j < jointCount; j++) difference += Math.abs(values[g * jointCount + j] - values[n * jointCount + j]);
        if (difference > .5) { affected[g] = 1; affected[n] = 1; }
    }
    for (let ring = 0; ring < (seamPairs ? 32 : 12); ring++) {
        const expanded = affected.slice();
        for (let g = 0; g < members.length; g++) if (affected[g]) for (const n of neighbors[g]) expanded[n] = 1;
        affected.set(expanded);
    }
    const initial = values.slice();
    for (let pass = 0; pass < iterations; pass++) {
        const next = values.slice();
        for (let g = 0; g < members.length; g++) {
            if (!affected[g] || locked[g] || !neighbors[g].size) continue;
            const rate = .72 / neighbors[g].size;
            for (let j = 0; j < jointCount; j++) {
                let average = 0; for (const n of neighbors[g]) average += values[n * jointCount + j];
                next[g * jointCount + j] = values[g * jointCount + j] * .28 + average * rate;
            }
        }
        values = next;
    }
    const joints = new Uint16Array(position.count * 4), weights = new Float32Array(position.count * 4);
    let changedVertices = 0, maximumWeightChange = 0;
    for (let g = 0; g < members.length; g++) {
        const packed = packContinuousPetSkinWeights(values.subarray(g * jointCount, (g + 1) * jointCount));
        const top = packed.joints;
        let difference = 0; for (let j = 0; j < jointCount; j++) difference += Math.abs(initial[g * jointCount + j] - (top.includes(j) ? packed.weights[top.indexOf(j)] : 0));
        maximumWeightChange = Math.max(maximumWeightChange, difference);
        if (difference > .001) changedVertices += members[g].length;
        for (const v of members[g]) for (let slot = 0; slot < 4; slot++) { joints[v * 4 + slot] = top[slot] ?? 0; weights[v * 4 + slot] = packed.weights[slot] ?? 0; }
    }
    const geometry = source.clone();
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
    return { geometry, changedVertices, maximumWeightChange, iterations };
}

/** Local repair for measured residual creases after four-influence packing.
 * Give the vertices of a stretched edge one common palette, and feather the
 * change into their immediate triangle neighbors. This affects only the
 * measured seam rather than increasing diffusion over the whole creature. */
export function repairPetSkinEdges(source: BufferGeometry, jointCount: number, pairs: readonly (readonly number[])[], headJoint = -1) {
    const joints = source.getAttribute('skinIndex'), weights = source.getAttribute('skinWeight'), index = source.index!;
    const values = new Float32Array(joints.count * jointCount);
    for (let v = 0; v < joints.count; v++) for (let i = 0; i < 4; i++) values[v * jointCount + joints.getComponent(v, i)] += weights.getComponent(v, i);
    const rigidHead = (v: number) => headJoint >= 0 && values[v * jointCount + headJoint] > .999;
    const targets = new Map<number, Float32Array>();
    const parent = new Map<number, number>();
    const find = (v: number): number => { if (!parent.has(v)) parent.set(v, v); if (parent.get(v) !== v) parent.set(v, find(parent.get(v)!)); return parent.get(v)!; };
    const unequalUvPairs = connectedUvSeamPairs(source).filter(([a, b]) => {
        for (let j = 0; j < jointCount; j++) if (Math.abs(values[a * jointCount + j] - values[b * jointCount + j]) > 1e-6) return true;
        return false;
    });
    for (const [a, b] of [...pairs, ...unequalUvPairs]) parent.set(find(a), find(b));
    const clusters = new Map<number, number[]>();
    for (const v of parent.keys()) { const root = find(v); if (!clusters.has(root)) clusters.set(root, []); clusters.get(root)!.push(v); }
    for (const vertices of clusters.values()) {
        const mean = new Float32Array(jointCount);
        for (const v of vertices) for (let j = 0; j < jointCount; j++) mean[j] += values[v * jointCount + j] / vertices.length;
        // A seam touching an eye, brow or other rigid skull detail must bring
        // its adjacent surface toward the skull rather than loosen the face.
        if (vertices.some(rigidHead)) { mean.fill(0); mean[headJoint] = 1; }
        const packed = packContinuousPetSkinWeights(mean);
        mean.fill(0);
        packed.joints.forEach((j, slot) => { mean[j] = packed.weights[slot]; });
        for (const v of vertices) targets.set(v, mean);
    }
    const position = source.getAttribute('position');
    const key = (v: number) => [position.getX(v), position.getY(v), position.getZ(v)].map(x => Math.round(x * 1e6)).join(',');
    const seamPositions = new Map([...targets].map(([v, target]) => [key(v), target]));
    for (let v = 0; v < joints.count; v++) { const target = seamPositions.get(key(v)); if (target) targets.set(v, target); }
    const neighbors = new Map<number, Set<number>>();
    for (let i = 0; i < index.count; i += 3) {
        const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        for (const v of triangle) if (targets.has(v)) for (const n of triangle) if (!targets.has(n)) {
            if (!neighbors.has(n)) neighbors.set(n, new Set()); neighbors.get(n)!.add(v);
        }
    }
    for (const [v, adjacent] of neighbors) {
        const target = new Float32Array(jointCount);
        for (let j = 0; j < jointCount; j++) { let sum = 0; for (const n of adjacent) sum += targets.get(n)![j]; target[j] = values[v * jointCount + j] * .65 + sum / adjacent.size * .35; }
        targets.set(v, target);
    }
    // Feathered neighbors also have UV duplicates. Updating only the triangle's
    // copy opens a new crease on the other side of that seam during the next
    // pose. Every touched position receives one shared influence palette.
    const weldedTargets = new Map<string, { value: Float32Array; count: number }>();
    for (const [v, target] of targets) {
        const positionKey = key(v);
        if (!weldedTargets.has(positionKey)) weldedTargets.set(positionKey, { value: new Float32Array(jointCount), count: 0 });
        const shared = weldedTargets.get(positionKey)!;
        for (let j = 0; j < jointCount; j++) shared.value[j] += target[j];
        shared.count++;
    }
    for (const shared of weldedTargets.values()) for (let j = 0; j < jointCount; j++) shared.value[j] /= shared.count;
    for (let v = 0; v < joints.count; v++) {
        const shared = weldedTargets.get(key(v));
        if (shared && rigidHead(v)) { shared.value.fill(0); shared.value[headJoint] = 1; }
    }
    for (let v = 0; v < joints.count; v++) { const shared = weldedTargets.get(key(v)); if (shared) targets.set(v, shared.value); }
    const outJoints = Uint16Array.from(joints.array), outWeights = Float32Array.from(weights.array);
    // Buffer attributes may be normalized integers; write their decoded values.
    for (let v = 0; v < joints.count; v++) for (let i = 0; i < 4; i++) { outJoints[v * 4 + i] = joints.getComponent(v, i); outWeights[v * 4 + i] = weights.getComponent(v, i); }
    for (const [v, target] of targets) {
        if (rigidHead(v)) continue;
        const packed = packContinuousPetSkinWeights(target);
        for (let i = 0; i < 4; i++) { outJoints[v * 4 + i] = packed.joints[i] ?? 0; outWeights[v * 4 + i] = packed.weights[i] ?? 0; }
    }
    const geometry = source.clone();
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(outJoints, 4)); geometry.setAttribute('skinWeight', new Float32BufferAttribute(outWeights, 4));
    return { geometry, changedVertices: targets.size, iterations: 0 };
}
