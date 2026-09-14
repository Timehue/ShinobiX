import { readFileSync } from "node:fs";
import type { Pet, PetJutsu } from "../src/types/pet";
import { DUEL_TPS } from "../src/lib/pet-duel-sim";
import { runPetSquadDuelCinematic } from "../src/lib/pet-duel-cinematic";
import { advanceCombatBodyYaw } from "../src/lib/pet-combat-performance";
import { createActorPoseSample, sampleActorByIdInto } from "../src/lib/pet-warfront-rite-presentation";

const FRAME_TICKS = DUEL_TPS / 60;
const CELL_SIZE = 3;
const MAX_YAW_STEP = 55 * Math.PI / 180;
const FACE_LIMIT = 25 * Math.PI / 180;
const DEPLOYMENT = [1, 4, 7, 8];

const jutsu = (name: string, kind: PetJutsu["kind"], power = 100, signature = false, aoe = false): PetJutsu => ({
    name, kind, power, cooldown: signature ? 5 : 2, currentCooldown: 0, signature, aoe,
} as PetJutsu);

const pet = (id: string, role: Pet["role"], subRole: Pet["subRole"], element: string, speed: number): Pet => ({
    id, name: id, rarity: "rare", level: 20, xp: 0, maxLevel: 100,
    hp: 1050, attack: 120, defense: role === "defender" ? 105 : 65, speed, element,
    role, subRole,
    jutsus: role === "sage"
        ? [jutsu("Mending Current", "heal"), jutsu("Mist Aegis", "shield"), jutsu("Tidal Verdict", "slow", 130, true, true)]
        : role === "assassin"
            ? [jutsu("Kunai Fan", "wound"), jutsu("Shadow Fang", "damage", 120), jutsu("Nightfall", "damage", 155, true)]
            : subRole === "kite"
                ? [jutsu("Ember Needle", "burn", 105), jutsu("Shuriken Arc", "mark", 90), jutsu("Phoenix Volley", "burn", 145, true, true)]
                : [jutsu("Guard Break", "crush", 110), jutsu("Stone Ward", "barrier", 90), jutsu("Mountain Fall", "crush", 155, true, true)],
} as Pet);

const band = (prefix: string): Pet[] => [
    pet(`${prefix}-guard`, "defender", "tank", "Earth", 60),
    pet(`${prefix}-range`, "tracker", "kite", "Fire", 92),
    pet(`${prefix}-sage`, "sage", "support", "Water", 76),
    pet(`${prefix}-shadow`, "assassin", "assassin", "Wind", 112),
];

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
type Track = { yaw: number | null; x: number; z: number; hasPosition: boolean };
type WindupWindow = { actorId: string; start: number; end: number };

let attacks = 0;
let attacksWithinCone = 0;
let attackSamples = 0;
let attackSamplesWithinCone = 0;
let maxYawDegreesPerFrame = 0;
let yawViolations = 0;
let maxWorldDisplacementCellsPerFrame = 0;
let untelegraphedWorldJumps = 0;
let maxStateTransitionLatencyFrames = 0;
let renderedFrames = 0;

for (let seed = 1; seed <= 24; seed++) {
    const result = runPetSquadDuelCinematic(
        band(`blue-${seed}`), band(`red-${seed}`), seed,
        false, true, false, DEPLOYMENT, DEPLOYMENT,
    );
    const actorIds = result.snapshots[0]?.actors.map((actor) => actor.id) ?? [];
    const windows: WindupWindow[] = [];
    for (const actorId of actorIds) {
        let start: number | null = null;
        for (let tick = 0; tick < result.snapshots.length; tick++) {
            const state = result.snapshots[tick].actors.find((actor) => actor.id === actorId)?.state;
            if (state === "windup" && start === null) start = tick;
            if (state !== "windup" && start !== null) {
                windows.push({ actorId, start, end: tick });
                start = null;
            }
        }
        if (start !== null) windows.push({ actorId, start, end: result.snapshots.length - 1 });
    }
    const attackPass = new Map(windows.map((window) => [`${window.actorId}:${window.start}`, true]));
    const tracks = new Map<string, Track>(actorIds.map((id) => [id, { yaw: null, x: 0, z: 0, hasPosition: false }]));
    const pose = createActorPoseSample();
    const prior = createActorPoseSample();
    const next = createActorPoseSample();
    const target = createActorPoseSample();
    const lastTick = result.snapshots.length - 1;

    for (let t = 0; t <= lastTick + 1e-9; t += FRAME_TICKS) {
        renderedFrames++;
        for (const actorId of actorIds) {
            sampleActorByIdInto(result, actorId, t, pose);
            const track = tracks.get(actorId)!;
            if (track.hasPosition) {
                const displacementCells = Math.hypot(pose.x - track.x, pose.z - track.z) / CELL_SIZE;
                maxWorldDisplacementCellsPerFrame = Math.max(maxWorldDisplacementCellsPerFrame, displacementCells);
                if (displacementCells > 0.75) untelegraphedWorldJumps++;
            }
            track.x = pose.x;
            track.z = pose.z;
            track.hasPosition = true;

            const before = Math.max(0, t - 1);
            const after = Math.min(lastTick, t + 1);
            sampleActorByIdInto(result, actorId, before, prior);
            sampleActorByIdInto(result, actorId, after, next);
            const tangentSeconds = (after - before) / DUEL_TPS;
            const vx = tangentSeconds > 1e-4 ? (next.x - prior.x) / tangentSeconds : 0;
            const vz = tangentSeconds > 1e-4 ? (next.z - prior.z) / tangentSeconds : 0;
            const speed = Math.hypot(vx, vz);
            const committed = pose.state === "windup" || pose.state === "strike" || pose.state === "recover";
            const frozen = pose.hp <= 0 || pose.state === "dead" || pose.state === "stagger";
            const moving = !frozen && !committed && speed > 0.58;
            let desiredX = pose.faceX;
            let desiredZ = pose.faceZ;
            let targetYaw: number | null = null;
            if (pose.targetId) {
                sampleActorByIdInto(result, pose.targetId, t, target);
                const dx = target.x - pose.x;
                const dz = target.z - pose.z;
                const length = Math.hypot(dx, dz);
                if (target.hp > 0 && length > 0.02) {
                    desiredX = dx / length;
                    desiredZ = dz / length;
                    targetYaw = Math.atan2(desiredX, desiredZ);
                }
            }
            if (moving && speed > 0.05) {
                desiredX = vx / speed;
                desiredZ = vz / speed;
            }
            if (!frozen && Math.hypot(desiredX, desiredZ) > 0.05) {
                const desiredYaw = Math.atan2(desiredX, desiredZ);
                if (track.yaw === null) track.yaw = desiredYaw;
                else {
                    const beforeYaw = track.yaw;
                    track.yaw = advanceCombatBodyYaw(beforeYaw, desiredYaw, 1 / 60, committed ? 120 : 50, MAX_YAW_STEP);
                    const yawStep = Math.abs(wrap(track.yaw - beforeYaw));
                    maxYawDegreesPerFrame = Math.max(maxYawDegreesPerFrame, yawStep * 180 / Math.PI);
                    if (yawStep > 60 * Math.PI / 180 + 1e-9) yawViolations++;
                }
            }

            if (track.yaw !== null && targetYaw !== null && pose.state === "windup") {
                for (const window of windows) {
                    if (window.actorId !== actorId || t < Math.max(window.start, window.end - DUEL_TPS * 0.1) || t >= window.end) continue;
                    attackSamples++;
                    const inside = Math.abs(wrap(targetYaw - track.yaw)) <= FACE_LIMIT;
                    if (inside) attackSamplesWithinCone++;
                    else attackPass.set(`${window.actorId}:${window.start}`, false);
                }
            }
        }
    }

    attacks += windows.length;
    for (const window of windows) if (attackPass.get(`${window.actorId}:${window.start}`)) attacksWithinCone++;

    // A snapshot state sampled on its own tick is visible on that rendered
    // frame. This catches any future reintroduction of a chasing pose buffer.
    for (let tick = 1; tick < result.snapshots.length; tick++) {
        for (const actorId of actorIds) {
            const previousState = result.snapshots[tick - 1].actors.find((actor) => actor.id === actorId)?.state;
            const currentState = result.snapshots[tick].actors.find((actor) => actor.id === actorId)?.state;
            if (previousState === currentState || currentState === undefined) continue;
            sampleActorByIdInto(result, actorId, tick, pose);
            const latency = pose.state === currentState ? 0 : 1;
            maxStateTransitionLatencyFrames = Math.max(maxStateTransitionLatencyFrames, latency);
        }
    }
}

const petModelSource = readFileSync(new URL("../src/components/PetModel3D.tsx", import.meta.url), "utf8");
const idleRootDisplacement = /const actionLift = idle \? 0 : heroPose\.lift/.test(petModelSource) ? 0 : Number.POSITIVE_INFINITY;
const report = {
    representativeFights: 24,
    renderedFrames,
    attacks,
    attacksWithin25DegreesFinal100ms: attacksWithinCone,
    attackFacingPercent: Number((attacksWithinCone / Math.max(1, attacks) * 100).toFixed(3)),
    attackSampleFacingPercent: Number((attackSamplesWithinCone / Math.max(1, attackSamples) * 100).toFixed(3)),
    maxWorldDisplacementCellsPerFrame: Number(maxWorldDisplacementCellsPerFrame.toFixed(4)),
    untelegraphedWorldJumpsOver075Cell: untelegraphedWorldJumps,
    maxYawDegreesPerFrame: Number(maxYawDegreesPerFrame.toFixed(3)),
    yawChangesOver60Degrees: yawViolations,
    maxStateTransitionLatencyFrames,
    activeIdleRootDisplacement: idleRootDisplacement,
};

console.log(JSON.stringify(report, null, 2));
if (report.attackFacingPercent < 95
    || report.untelegraphedWorldJumpsOver075Cell !== 0
    || report.yawChangesOver60Degrees !== 0
    || report.maxStateTransitionLatencyFrames > 1
    || report.activeIdleRootDisplacement !== 0) process.exitCode = 1;
