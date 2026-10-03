import * as THREE from 'three';

type Probe = { mesh: THREE.Mesh; index: number; uses: number };
type Joint = { lower: THREE.Bone; tip?: THREE.Bone; lowerPose: THREE.Quaternion; tipPose?: THREE.Quaternion; side: number; front: boolean };
const SOLE = /^(foot|front_paw|hind_paw|shin|front_lower|hind_lower)[.]?[LR]$/;
const BELLY = /^(root|pelvis|spine|chest)$/;
const MAX_PROBES = 96;

/** Rear-view recovery for generic rigs, matching the shipped Rally sprites.
 * Restore it before the mixer runs: unkeyed joints otherwise accumulate the
 * additive fold or carry it into a waiting, jump or finish pose. */
function strideRecovery(root: THREE.Object3D, preserveAuthored: boolean) {
    const joints: Joint[] = [];
    if (!preserveAuthored) root.traverse(node => {
        if (!(node instanceof THREE.Bone)) return;
        const match = /^(front_lower|hind_lower|shin)([.]?[LR])$/.exec(node.name);
        if (!match) return;
        const tip = root.getObjectByName((match[1] === 'shin' ? 'foot' : match[1].replace('lower', 'paw')) + match[2]);
        joints.push({ lower: node, tip: tip instanceof THREE.Bone && tip.parent === node ? tip : undefined,
            lowerPose: node.quaternion.clone(), tipPose: tip instanceof THREE.Bone ? tip.quaternion.clone() : undefined,
            side: match[2].endsWith('L') ? 0 : .5, front: match[1] === 'front_lower' });
    });
    const axis = new THREE.Vector3(1, 0, 0), turn = new THREE.Quaternion();
    let applied = false;
    const restore = () => {
        if (!applied) return;
        for (const joint of joints) { joint.lower.quaternion.copy(joint.lowerPose); if (joint.tip && joint.tipPose) joint.tip.quaternion.copy(joint.tipPose); }
        applied = false;
    };
    return { restore, apply: (phase: number) => {
        restore();
        for (const joint of joints) {
            joint.lowerPose.copy(joint.lower.quaternion); if (joint.tip && joint.tipPose) joint.tipPose.copy(joint.tip.quaternion);
            const lift = Math.max(0, Math.sin((phase + joint.side + (joint.front ? .5 : 0)) * Math.PI * 2));
            joint.lower.quaternion.multiply(turn.setFromAxisAngle(axis, -lift * .65));
            joint.tip?.quaternion.multiply(turn.setFromAxisAngle(axis, lift * .4));
        }
        applied = joints.length > 0;
        return preserveAuthored ? 0 : Math.sin(phase * Math.PI * 2) * .025;
    } };
}

/** Probe actual skinned soles rather than tails, weapons or a static idle box.
 * Each preparation samples the relevant poses once and retains only the low
 * surface envelope. Playback evaluates at most 96 vertices per pet, without a
 * full geometry scan, new textures, or any change to race physics. */
export function createRallyRigPose(root: THREE.Object3D, bank: ReadonlyMap<string, THREE.AnimationClip>, preserveAuthored = false) {
    const recovery = strideRecovery(root, preserveAuthored);
    const sole: Probe[] = [], belly: Probe[] = [], silhouette: Probe[] = [];
    root.traverse(node => {
        if (!(node instanceof THREE.Mesh) || !node.visible) return;
        const geometry = node.geometry, indices = geometry.index, positions = geometry.getAttribute('position');
        if (!positions) return;
        const count = indices?.count ?? positions.count, start = Math.max(0, geometry.drawRange.start), end = Math.min(count, start + geometry.drawRange.count);
        const used = new Set<number>();
        const groups = Array.isArray(node.material) ? geometry.groups : [{ start, count: end - start, materialIndex: 0 }];
        for (const group of groups) {
            const material = Array.isArray(node.material) ? node.material[group.materialIndex] : node.material;
            if (!material?.visible) continue;
            for (let entry = Math.max(start, group.start); entry < Math.min(end, group.start + group.count); entry++) used.add(indices ? indices.getX(entry) : entry);
        }
        const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
        for (const index of used) {
            const probe = { mesh: node, index, uses: 0 }; silhouette.push(probe);
            if (!(node instanceof THREE.SkinnedMesh) || !skinIndex || !skinWeight) continue;
            let footWeight = 0, bodyWeight = 0;
            for (let influence = 0; influence < 4; influence++) {
                const bone = node.skeleton.bones[skinIndex.getComponent(index, influence)], weight = skinWeight.getComponent(index, influence);
                if (SOLE.test(bone?.name ?? '')) footWeight += weight;
                if (BELLY.test(bone?.name ?? '')) bodyWeight += weight;
            }
            if (footWeight >= .4) sole.push(probe);
            if (bodyWeight >= .5) belly.push(probe);
        }
    });
    const method = sole.length >= 6 ? 'sole' : belly.length >= 6 ? 'belly' : 'silhouette';
    const candidates = method === 'sole' ? sole : method === 'belly' ? belly : silhouette;
    const saved: { node: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
    root.traverse(node => saved.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
    const point = new THREE.Vector3(), inverse = new THREE.Matrix4(), mixer = new THREE.AnimationMixer(root);
    const selected = new Set<Probe>();
    // Also sample the support corners used when steering or pitching, so a
    // slanted paw stays planted rather than pushing its center into the road.
    const directions = [-.2, 0, .2].flatMap(x => [-.15, 0, .15].map(z => ({ x, z })));
    for (const name of ['guard', 'gallop', 'gallop_jump']) {
        const clip = bank.get(name); if (!clip) continue;
        for (let sample = 0; sample < 16; sample++) {
            recovery.restore(); mixer.stopAllAction();
            const action = mixer.clipAction(clip).reset().play(); action.time = clip.duration * sample / 16; action.paused = true; mixer.update(0);
            if (name === 'gallop') recovery.apply(sample / 16);
            root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
            const lows = directions.map(() => Infinity), winners: (Probe | undefined)[] = directions.map(() => undefined);
            for (const probe of candidates) {
                probe.mesh.getVertexPosition(probe.index, point); point.applyMatrix4(probe.mesh.matrixWorld);
                if (!Number.isFinite(point.x + point.y + point.z)) continue;
                directions.forEach((direction, index) => { const height = point.y + point.x * direction.x + point.z * direction.z;
                    if (height < lows[index]) { lows[index] = height; winners[index] = probe; } });
            }
            for (const winner of winners) if (winner) { winner.uses++; selected.add(winner); }
        }
    }
    recovery.restore(); mixer.stopAllAction(); mixer.uncacheRoot(root);
    for (const value of saved) { value.node.position.copy(value.position); value.node.quaternion.copy(value.quaternion); value.node.scale.copy(value.scale); }
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    const probes = [...selected].sort((left, right) => right.uses - left.uses).slice(0, MAX_PROBES);
    sole.length = 0; belly.length = 0; silhouette.length = 0; saved.length = 0; selected.clear();
    return {
        method, probeCount: probes.length,
        restoreStride: recovery.restore, applyStride: recovery.apply,
        ground: (body: THREE.Object3D, actor: THREE.Object3D) => {
            body.position.y = 0;
            // SkinnedMesh.updateMatrixWorld refreshes bindMatrixInverse as well
            // as node matrices; updateWorldMatrix alone leaves it one pose old.
            actor.updateWorldMatrix(true, false); actor.updateMatrixWorld(true); inverse.copy(actor.matrixWorld).invert();
            let low = Infinity;
            for (const probe of probes) {
                probe.mesh.getVertexPosition(probe.index, point); point.applyMatrix4(probe.mesh.matrixWorld).applyMatrix4(inverse);
                if (Number.isFinite(point.y)) low = Math.min(low, point.y);
            }
            // Legacy malformed armatures keep the established static fallback.
            body.position.y = Number.isFinite(low) && Math.abs(low) <= 2.8 ? -low : 0;
            return body.position.y;
        },
    };
}
