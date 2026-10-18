import { Object3D, Group, Quaternion, Vector3, Euler, Matrix4 } from 'three';
import { readStudioAccessor } from './pet-studio-glb.mjs';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const wrap = x => ((x % 1) + 1) % 1;
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const TAU = Math.PI * 2;
export const CHARACTER_MOTION_REVISION = '20261014-contact-performance-v1';

const frameTransform = (node, frame) => new Matrix4().copy(frame.matrixWorld).invert().multiply(node.matrixWorld);
const framePosition = (node, frame) => new Vector3().setFromMatrixPosition(frameTransform(node, frame));
const frameQuaternion = (node, frame) => { const q = new Quaternion(); frameTransform(node, frame).decompose(new Vector3(), q, new Vector3()); return q; };

/** A continuous contact/swing trajectory. Contact travels at constant ground
 * speed; swing shares its end velocities and lifts with zero vertical velocity. */
export function footTrajectory(phase, span, clearance, duty) {
    const u = wrap(phase);
    if (u <= duty) return { z: span * (.5 - u / duty), y: 0, contact: true };
    const q = (u - duty) / (1 - duty), m = -span * (1 - duty) / duty;
    return { z: (-span / 2) * (2 * q ** 3 - 3 * q ** 2 + 1)
        + (span / 2) * (-2 * q ** 3 + 3 * q ** 2) + m * (2 * q ** 3 - 3 * q ** 2 + q),
        y: clearance * Math.sin(Math.PI * q) ** 2, contact: false };
}

export function createCharacterRig(json) {
    const scene = new Group(), nodes = json.nodes.map(n => {
        const object = new Object3D(); object.name = n.name ?? '';
        if (n.matrix) object.matrix.fromArray(n.matrix).decompose(object.position, object.quaternion, object.scale);
        else { object.position.fromArray(n.translation ?? [0, 0, 0]); object.quaternion.fromArray(n.rotation ?? [0, 0, 0, 1]); object.scale.fromArray(n.scale ?? [1, 1, 1]); }
        return object;
    });
    json.nodes.forEach((n, i) => n.children?.forEach(child => nodes[i].add(nodes[child])));
    nodes.filter(n => !n.parent).forEach(n => scene.add(n)); scene.updateMatrixWorld(true);
    const bind = nodes.map(n => ({ p: n.position.clone(), q: n.quaternion.clone(), s: n.scale.clone() }));
    const byName = new Map(nodes.map((n, i) => [n.name, i]));
    const chains = [];
    const add = (upper, lower, foot, kind, side, part = '') => {
        const ids = [upper, lower, foot].map(name => byName.get(name));
        if (ids.some(i => i === undefined)) return;
        const [a, b, c] = ids.map(i => nodes[i]);
        if (b.parent !== a || c.parent !== b) return;
        // Work below the armature's object transform. Evolved models can have
        // nonuniform object scales; world-space quaternions cannot solve those.
        let frame = a.parent; while (frame.parent && frame.name !== 'root') frame = frame.parent;
        if (frame.name === 'root') frame = frame.parent;
        const A = framePosition(a, frame), B = framePosition(b, frame), C = framePosition(c, frame);
        const length = A.distanceTo(B) + B.distanceTo(C);
        if (length < .0001) return;
        const pole = B.clone().sub(A); const direction = C.clone().sub(A).normalize();
        pole.addScaledVector(direction, -pole.dot(direction));
        if (pole.lengthSq() < 1e-8) pole.set(kind === 'tripod' ? side === 'L' ? 1 : -1 : 0, 0, part === 'hind' ? -1 : 1);
        const inverseFrame = new Matrix4().copy(frame.matrixWorld).invert();
        const up = new Vector3(0, 1, 0).transformDirection(inverseFrame);
        const forward = new Vector3(0, 0, 1).transformDirection(inverseFrame);
        chains.push({ ids, kind, side, part, frame, up, forward, length, origin: C, orientation: frameQuaternion(c, frame), pole: pole.normalize() });
    };
    for (const side of ['L', 'R']) {
        for (const part of ['front', 'hind']) add(`${part}_upper.${side}`, `${part}_lower.${side}`, `${part}_paw.${side}`, 'quadruped', side, part);
        add(`thigh.${side}`, `shin.${side}`, `foot.${side}`, 'biped', side);
        for (const part of ['front', 'mid', 'rear']) add(`leg_${part}_upper.${side}`, `leg_${part}_lower.${side}`, `leg_${part}_foot.${side}`, 'tripod', side, part);
    }
    return { scene, nodes, bind, byName, chains, reset() { nodes.forEach((n, i) => { n.position.copy(bind[i].p); n.quaternion.copy(bind[i].q); n.scale.copy(bind[i].s); }); } };
}

/** Two-link solution in the rig's actual world frame. The knee plane follows
 * its measured bind pose instead of assuming an axis or humanoid proportions. */
export function solveFoot(rig, chain, target, orientation = chain.orientation) {
    rig.scene.updateMatrixWorld(true);
    const [a, b, c] = chain.ids.map(i => rig.nodes[i]);
    const A = framePosition(a, chain.frame), B = framePosition(b, chain.frame), C = framePosition(c, chain.frame);
    const l1 = A.distanceTo(B), l2 = B.distanceTo(C), direction = target.clone().sub(A);
    const distance = clamp(direction.length(), Math.abs(l1 - l2) + 1e-6, (l1 + l2) * .9999); direction.normalize();
    const pole = chain.pole.clone().addScaledVector(direction, -chain.pole.dot(direction));
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1).addScaledVector(direction, -direction.z);
    pole.normalize();
    const x = (l1 * l1 + distance * distance - l2 * l2) / (2 * distance);
    const knee = A.clone().addScaledVector(direction, x).addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - x * x)));
    const upperWorld = new Quaternion().setFromUnitVectors(B.clone().sub(A).normalize(), knee.clone().sub(A).normalize()).multiply(frameQuaternion(a, chain.frame));
    a.quaternion.copy(frameQuaternion(a.parent, chain.frame).invert().multiply(upperWorld));
    rig.scene.updateMatrixWorld(true);
    const nextB = framePosition(b, chain.frame), nextC = framePosition(c, chain.frame);
    const reached = A.clone().addScaledVector(direction, distance);
    const lowerWorld = new Quaternion().setFromUnitVectors(nextC.sub(nextB).normalize(), reached.sub(nextB).normalize()).multiply(frameQuaternion(b, chain.frame));
    b.quaternion.copy(frameQuaternion(b.parent, chain.frame).invert().multiply(lowerWorld));
    rig.scene.updateMatrixWorld(true);
    c.quaternion.copy(frameQuaternion(c.parent, chain.frame).invert().multiply(orientation));
    rig.scene.updateMatrixWorld(true);
    return framePosition(c, chain.frame).distanceTo(target);
}

export function sampleChannel(channel, p) {
    const { times, values, width, interpolation } = channel, time = clamp(p) * times.at(-1);
    let a = 0; while (a < times.length - 2 && time > times[a + 1]) a++;
    const b = Math.min(a + 1, times.length - 1), span = times[b] - times[a], u = span > 0 ? clamp((time - times[a]) / span) : 0;
    if (interpolation !== 'CUBICSPLINE') {
        if (channel.path === 'rotation') return new Quaternion().fromArray(values, a * 4).slerp(new Quaternion().fromArray(values, b * 4), interpolation === 'STEP' ? 0 : u).toArray();
        return Array.from({ length: width }, (_, k) => values[a * width + k] * (1 - u) + values[b * width + k] * u);
    }
    const result = Array.from({ length: width }, (_, k) => (2 * u ** 3 - 3 * u ** 2 + 1) * values[a * width * 3 + width + k]
        + (u ** 3 - 2 * u ** 2 + u) * span * values[a * width * 3 + width * 2 + k]
        + (-2 * u ** 3 + 3 * u ** 2) * values[b * width * 3 + width + k]
        + (u ** 3 - u ** 2) * span * values[b * width * 3 + k]);
    return channel.path === 'rotation' ? new Quaternion().fromArray(result).normalize().toArray() : result;
}

export async function readCharacterTake(json, bin, clip) {
    const channels = await Promise.all(clip.channels.map(async channel => {
        const sampler = clip.samplers[channel.sampler], [input, output] = await Promise.all([readStudioAccessor(json, bin, sampler.input), readStudioAccessor(json, bin, sampler.output)]);
        return { node: channel.target.node, name: json.nodes[channel.target.node].name, path: channel.target.path,
            times: input.values, values: output.values, width: output.width, interpolation: sampler.interpolation };
    }));
    return { channels, duration: Math.max(...channels.map(c => c.times.at(-1))) };
}

function pose(rig, channels, p) {
    rig.reset();
    for (const channel of channels) {
        const value = sampleChannel(channel, p), node = rig.nodes[channel.node];
        if (channel.path === 'rotation') node.quaternion.fromArray(value);
        else if (channel.path === 'translation') node.position.fromArray(value);
        else if (channel.path === 'scale') node.scale.fromArray(value);
    }
    rig.scene.updateMatrixWorld(true);
}

const SUPPORT = new Set(['idle', 'walk', 'gallop', 'guard', 'rest']);
const CYCLE = new Set(['idle', 'walk', 'gallop', 'guard', 'rest']);
export function finishCharacterTake(rig, take, clipName, family, showcase = false, gaitStrideScale = 1) {
    if (!(gaitStrideScale > 0 && gaitStrideScale <= 1)) throw Error('Invalid gait stride scale');
    const walking = clipName === 'walk' || clipName === 'gallop', running = clipName === 'gallop';
    const heavy = ['armored', 'charger', 'burrow-grappler'].includes(family), spring = family === 'hopper';
    const aquatic = ['aquatic', 'serpentine', 'amphibious'].includes(family);
    const support = SUPPORT.has(clipName) && !aquatic;
    const cyclic = CYCLE.has(clipName), baseIntervals = walking ? 16 : clipName === 'guard' ? 4 : 8;
    const intervals = showcase ? Math.max(baseIntervals, ...take.channels.map(c => c.times.length - 1)) : baseIntervals;
    const times = cyclic ? Float32Array.from({ length: intervals + 1 }, (_, i) => i / intervals * take.duration)
        : take.channels[0].times;
    const changed = new Map(), contacts = [];
    const key = (node, path) => `${node}:${path}`;
    const remember = (node, path) => { if (!changed.has(key(node, path))) changed.set(key(node, path), { node, path, values: [] }); };
    if (cyclic) take.channels.forEach(c => remember(c.node, c.path));
    if (support && rig.chains.length) {
        rig.chains.forEach(chain => chain.ids.forEach(i => remember(i, 'rotation')));
        if (rig.byName.has('root')) remember(rig.byName.get('root'), 'translation');
    }
    const tracks = new Map(take.channels.map(c => [c.name, c]));
    const followers = [['tail_1', 'tail_2', .06, .38], ['tail_1', 'tail_3', .12, .23], ['scarf_1', 'scarf_2', .09, .3],
        ['head', 'neck', .04, .08], ['wing_upper.L', 'wing_mid.L', .04, .2], ['wing_upper.R', 'wing_mid.R', .04, .2],
        ['wing_upper.L', 'wing_tip.L', .09, .12], ['wing_upper.R', 'wing_tip.R', .09, .12],
        ['bat_wing_upper.L', 'bat_wing_lower.L', .06, .18], ['bat_wing_upper.R', 'bat_wing_lower.R', .06, .18]]
        .filter(([source, target]) => tracks.has(source) && rig.byName.has(target) && !tracks.has(target));
    followers.forEach(([, target]) => remember(rig.byName.get(target), 'rotation'));
    if (cyclic && !showcase) for (const side of ['L', 'R']) for (const part of ['forearm', 'hand']) {
        const id = rig.byName.get(`${part}.${side}`); if (id !== undefined && !tracks.has(`${part}.${side}`)) remember(id, 'rotation');
    }
    if (!changed.size) return null;
    for (const time of times) {
        const p = time / take.duration, sourceP = clipName === 'guard' ? .48 + .025 * Math.sin(TAU * p) : p;
        pose(rig, take.channels, sourceP);
        for (const [source, target, lag, gain] of followers) {
            const sourceId = rig.byName.get(source), targetId = rig.byName.get(target), at = cyclic ? wrap(p - lag) : Math.max(0, p - lag);
            const delta = rig.bind[sourceId].q.clone().invert().multiply(new Quaternion().fromArray(sampleChannel(tracks.get(source), at)));
            const angles = new Euler().setFromQuaternion(delta, 'XYZ');
            const envelope = cyclic ? 1 : smooth(p / .1) * (1 - smooth((p - .84) / .16));
            rig.nodes[targetId].quaternion.copy(rig.bind[targetId].q).multiply(new Quaternion().setFromEuler(new Euler(
                clamp(angles.x * gain, -.13, .13) * envelope, clamp(angles.y * gain, -.16, .16) * envelope, clamp(angles.z * gain, -.13, .13) * envelope)));
        }
        if (cyclic && !showcase) for (const side of ['L', 'R']) {
            const phase = p + (side === 'L' ? 0 : .5), swing = Math.sin(TAU * phase);
            for (const part of ['forearm', 'hand']) {
                const id = rig.byName.get(`${part}.${side}`); if (id === undefined || tracks.has(`${part}.${side}`)) continue;
                const amount = part === 'forearm' ? walking ? .11 + .065 * swing : .025 + .009 * Math.sin(TAU * p) : walking ? -.04 - .025 * swing : -.008;
                rig.nodes[id].quaternion.copy(rig.bind[id].q).multiply(new Quaternion().setFromEuler(new Euler(amount, 0, 0)));
            }
        }
        if (support && rig.chains.length) {
            const length = rig.chains.reduce((sum, chain) => sum + chain.length, 0) / rig.chains.length;
            const root = rig.nodes[rig.byName.get('root')];
            const up = rig.chains[0].up, forward = rig.chains[0].forward;
            if (root) {
                const rootBind = rig.bind[rig.byName.get('root')].p, delta = root.position.clone().sub(rootBind);
                const bias = walking ? running ? .15 : .09 : .025;
                root.position.copy(rootBind).addScaledVector(up, -length * bias + delta.y * (walking ? .25 : .15))
                    .addScaledVector(forward, delta.z * .4).addScaledVector(new Vector3().crossVectors(up, forward), delta.x);
            }
            const targets = rig.chains.map(chain => {
                let phase = chain.side === 'L' ? 0 : .5;
                let duty = running ? .48 : .64;
                if (chain.kind === 'quadruped') {
                    phase += chain.part === 'hind' ? .5 : 0;
                    if (running && !heavy) phase = (chain.part === 'hind' ? .55 : 0) + (chain.side === 'L' ? 0 : .075);
                } else if (chain.kind === 'tripod') phase += chain.part === 'mid' ? .5 : 0;
                if (heavy) { duty = .74; phase = (chain.side === 'L' ? 0 : .5) + (chain.part === 'hind' ? .25 : 0); }
                if (spring && running) { duty = .4; phase = chain.side === 'L' ? 0 : .065; }
                const span = chain.length * (walking ? running ? heavy ? .48 : .72 : .48 : 0) * gaitStrideScale;
                const step = walking ? footTrajectory(p + phase, span, chain.length * (running ? .2 : .12), duty) : { z: 0, y: 0, contact: true };
                const target = chain.origin.clone().addScaledVector(chain.up, step.y).addScaledVector(chain.forward, step.z);
                const orientation = chain.orientation.clone().multiply(new Quaternion().setFromEuler(new Euler(step.y / chain.length * .6, 0, 0)));
                return { chain, target, orientation, step };
            });
            // Keep the whole support pose inside the measured leg reach. This
            // limits body bob without scaling bones or lifting planted feet.
            rig.scene.updateMatrixWorld(true);
            let low = -Infinity, high = Infinity;
            for (const { chain, target } of targets) {
                const hip = framePosition(rig.nodes[chain.ids[0]], chain.frame);
                const offset = target.clone().sub(hip), height = offset.dot(chain.up);
                const horizontal = Math.max(0, offset.lengthSq() - height * height);
                const vertical = Math.sqrt(Math.max(0, (chain.length * .994) ** 2 - horizontal));
                low = Math.max(low, height - vertical);
                high = Math.min(high, height + vertical);
            }
            if (root && low <= high) root.position.addScaledVector(up, clamp(0, low, high));
            for (const { chain, target, orientation, step } of targets) {
                const error = solveFoot(rig, chain, target, orientation);
                if (step.contact) contacts.push({ time, foot: rig.nodes[chain.ids[2]].name, error, legLength: chain.length });
            }
        }
        for (const channel of changed.values()) {
            const node = rig.nodes[channel.node];
            channel.values.push(...(channel.path === 'rotation' ? node.quaternion.toArray() : channel.path === 'translation' ? node.position.toArray() : node.scale.toArray()));
        }
    }
    if (cyclic) for (const channel of changed.values()) {
        const width = channel.path === 'rotation' ? 4 : 3;
        channel.values.splice(channel.values.length - width, width, ...channel.values.slice(0, width));
    }
    return { times, channels: [...changed.values()], contacts, cyclic, direction: spring ? 'spring-loaded' : heavy ? 'weighted-support' : family === 'avian' ? 'perched-and-wing-follow-through' : family };
}
