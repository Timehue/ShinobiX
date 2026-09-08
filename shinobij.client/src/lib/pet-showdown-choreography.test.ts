import assert from "node:assert/strict";
import test from "node:test";
import {
    showdownBodyRadius,
    showdownAttackRhythm,
    showdownCinematicImpulse,
    showdownContactGap,
    showdownMeleeContact,
    showdownMeleeDrive,
    showdownPerformanceVariant,
    showdownReactionRecoil,
    showdownMeleeRoute,
    showdownRoutePoint,
    showdownSegmentClearance,
    showdownReactionPosition,
    showdownReserveRoute,
    showdownTravelProgress,
    SHOWDOWN_SWITCH_TIMING,
} from "./pet-showdown-choreography";

test("clear melee lanes retain their original contact point and return path", () => {
    const from = { x: -1.8, z: 4.1 }, to = { x: 1.8, z: -4.1 };
    const contact = showdownMeleeContact(from.x, from.z, to.x, to.z, 0.82, 0.82);
    const route = showdownMeleeRoute(from, to, 0.82, 0.82, []);
    assert.equal(route.detoured, false);
    assert.deepEqual(route.points[1], { x: contact.x, z: contact.z });
    assert.equal(route.impactX, contact.impactX);
    assert.equal(route.impactZ, contact.impactZ);
    assert.equal(showdownRoutePoint(route, showdownMeleeDrive(1)).x, from.x);
    assert.equal(showdownRoutePoint(route, showdownMeleeDrive(1)).z, from.z);
});

test("detours round their corners and finish facing the target", () => {
    const from = { x: -3.6, z: 4.1 }, to = { x: 3.6, z: -4.1 };
    const obstacles = [{ x: 0, z: 4.1, radius: 1.58 }, { x: 3.6, z: 4.1, radius: 1.58 }, { x: -3.6, z: -4.1, radius: 1.58 }, { x: 0, z: -4.1, radius: 1.58 }];
    const route = showdownMeleeRoute(from, to, 1.58, 1.58, obstacles, 1.48);
    assert.ok(route.detoured && route.points.length > 10);
    let previous: { x: number; z: number } | null = null;
    for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1], b = route.points[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 1e-8) continue;
        const tangent = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
        if (previous) assert.ok(Math.acos(Math.min(1, previous.x * tangent.x + previous.z * tangent.z)) < 0.2, "rounded turns must not snap by 90 degrees");
        previous = tangent;
    }
    const end = showdownRoutePoint(route, 1);
    assert.ok(Math.abs(end.dx) < 1e-8 && end.dz < -0.99);
});

test("reserve entry and exit clear every occupied slot on both sides", () => {
    for (const side of ["player", "enemy"] as const) for (const slot of [-3.6, 0, 3.6]) for (const benchIndex of [0, 1, 2]) for (const radius of [0.62, 1.1, 1.58]) {
        const sign = side === "player" ? 1 : -1;
        const field = { x: slot, z: 4.1 * sign }, bench = { x: -sign * (10.4 + benchIndex * 1.2), z: 6.2 * sign };
        const obstacles = [-3.6, 0, 3.6].filter(x => x !== slot).map(x => ({ x, z: field.z, radius: 1.58 }));
        for (const [from, to] of [[field, bench], [bench, field]]) {
            const route = showdownReserveRoute(from, to, radius, obstacles, side);
            assert.ok(route.length > 0);
            assert.deepEqual(route.points[0], from);
            assert.deepEqual(route.points[route.points.length - 1], to);
            for (let i = 1; i < route.points.length; i++) for (const obstacle of obstacles) {
                assert.ok(showdownSegmentClearance(route.points[i - 1], route.points[i], obstacle) >= radius + obstacle.radius + 0.079);
            }
            for (const duration of [2200, 4400]) for (const speed of [1, 2]) {
                const beatEnd = duration / speed;
                const start = SHOWDOWN_SWITCH_TIMING.entryStart, end = SHOWDOWN_SWITCH_TIMING.entryEnd;
                const progress = showdownTravelProgress(((beatEnd - 1) / beatEnd - start) / (end - start));
                const landing = showdownRoutePoint(route, progress);
                assert.ok(Math.hypot(landing.x - to.x, landing.z - to.z) < 1e-8, "reserve must land before the next beat");
            }
        }
    }
    assert.ok(SHOWDOWN_SWITCH_TIMING.exitEnd < SHOWDOWN_SWITCH_TIMING.entryStart, "two reserves cannot occupy a shared corridor simultaneously");
});

test("large pets can dodge or recoil without crossing a neighbouring lane", () => {
    const from = { x: 0, z: 4.1 };
    for (const direction of [-1, 1]) {
        const neighbour = { x: 3.6 * direction, z: 4.1, radius: 1.58 };
        const clipped = showdownReactionPosition(from, { x: 1.5 * direction, z: 4.1 }, 1.58, [neighbour]);
        assert.ok(Math.abs(Math.abs(clipped.x) - 0.36) < 1e-8);
        assert.ok(showdownSegmentClearance(from, clipped, neighbour) >= 3.239999);
        const away = { x: -1.5 * direction, z: 4.1 };
        assert.deepEqual(showdownReactionPosition(from, away, 1.58, [neighbour]), away);
        assert.deepEqual(showdownReactionPosition(from, from, 1.58, [neighbour]), from);
    }
});

test("every 3v3 lane clears bystanders for all body profiles, including the largest silhouettes", () => {
    const profiles = ["quadruped", "biped", "avian", "serpentine", "heavy"] as const;
    let detours = 0;
    for (const profile of profiles) for (const direction of [-1, 1]) for (const fromX of [-3.6, 0, 3.6]) for (const toX of [-3.6, 0, 3.6]) {
        const radius = showdownBodyRadius({ targetHeight: 2.65, rarity: "mythic", presentationScale: 1.2, profile });
        const from = { x: fromX, z: 4.1 * direction }, to = { x: toX, z: -4.1 * direction };
        const obstacles = [-3.6, 0, 3.6].flatMap(x => [
            ...(x === fromX ? [] : [{ x, z: from.z, radius: 1.58 }]),
            ...(x === toX ? [] : [{ x, z: to.z, radius: 1.58 }]),
        ]);
        const route = showdownMeleeRoute(from, to, radius, 1.58, obstacles, 1.48);
        assert.ok(route.length > 0, `formation must leave a usable route: ${profile}/${fromX}/${toX}`);
        if (route.detoured) detours++;
        for (let i = 1; i < route.points.length; i++) for (const obstacle of obstacles) {
            assert.ok(showdownSegmentClearance(route.points[i - 1], route.points[i], obstacle) >= radius + obstacle.radius + 0.079);
        }
        const end = showdownRoutePoint(route, 1);
        assert.ok(Math.abs(Math.hypot(end.x - to.x, end.z - to.z) - showdownContactGap(radius, 1.58, 1.48)) < 1e-8);
        for (let frame = 0; frame <= 120; frame++) {
            const point = showdownRoutePoint(route, showdownMeleeDrive(frame / 120));
            for (const obstacle of obstacles) assert.ok(Math.hypot(point.x - obstacle.x, point.z - obstacle.z) >= radius + obstacle.radius);
        }
    }
    assert.ok(detours > 0, "large diagonal attacks must exercise obstacle avoidance");
});

test("a fully blocked custom formation cannot send a root through a bystander", () => {
    const from = { x: 0, z: 4.1 };
    const route = showdownMeleeRoute(from, { x: 0, z: -4.1 }, 1, 1, [{ x: 0, z: 3, radius: 1.58 }]);
    assert.equal(route.length, 0);
    for (const progress of [-1, 0, 0.5, 1, 2]) {
        assert.equal(showdownRoutePoint(route, progress).x, from.x);
        assert.equal(showdownRoutePoint(route, progress).z, from.z);
    }
});

test("Pet Showdown keeps a visible impact core between Red Fox and Blue Frog", () => {
        const fox = showdownBodyRadius({ targetHeight: 2.35, profile: "quadruped" });
        const frog = showdownBodyRadius({ targetHeight: 2.1, profile: "biped" });
        const contact = showdownMeleeContact(0, 4.1, 0, -4.1, fox, frog);
        const remaining = Math.abs(contact.z - -4.1);
        assert.ok(Math.abs(remaining - showdownContactGap(fox, frog)) < 0.00001);
        assert.ok(remaining - fox - frog >= 0.58);
        assert.ok(contact.impactZ < contact.z - fox);
        assert.ok(contact.impactZ > -4.1 + frog);
});

test("Pet Showdown melee never overshoots contact and returns home after recovery", () => {
        assert.equal(showdownMeleeDrive(0.31), 0);
        assert.equal(showdownMeleeDrive(0.55), 1);
        assert.equal(showdownMeleeDrive(1), 0);
});

test("Pet Showdown shares a weight-aware anticipation, contact, and recovery clock", () => {
    const quick = showdownAttackRhythm({ weight: "light", superMove: false, delivery: "melee" });
    const heavy = showdownAttackRhythm({ weight: "heavy", superMove: false, delivery: "melee", moveKind: "crush" });
    const ranged = showdownAttackRhythm({ weight: "normal", superMove: false, delivery: "ranged" });
    assert.ok(heavy.windupStart < heavy.dashStart);
    assert.ok(heavy.dashStart < heavy.contact);
    assert.ok(heavy.contact < heavy.contactEnd);
    assert.ok(heavy.contactEnd < heavy.recoverEnd);
    assert.ok(heavy.contact > quick.contact);
    assert.equal(ranged.dashStart, ranged.contact);
    assert.equal(showdownMeleeDrive(heavy.contact, heavy), 1);
    assert.equal(showdownMeleeDrive(heavy.recoverEnd, heavy), 0);
});

test("strongly committed signature poses reserve extra limb reach", () => {
        const attacker = showdownBodyRadius({ targetHeight: 2.65, profile: "heavy", rarity: "mythic" });
        const defender = showdownBodyRadius({ targetHeight: 2.35, profile: "quadruped" });
        const neutral = showdownMeleeContact(0, 5, 0, -5, attacker, defender, 1);
        const committed = showdownMeleeContact(0, 5, 0, -5, attacker, defender, 1.48);
        assert.ok(committed.travel < neutral.travel);
        assert.ok(committed.gap > neutral.gap);
        assert.ok(committed.impactZ < committed.z - attacker);
        assert.ok(committed.impactZ > -5 + defender);
});

test("Pet Showdown gives heavy pets less root recoil than airborne pets", () => {
        assert.ok(showdownReactionRecoil(1.1, "heavy", 170) < showdownReactionRecoil(1.1, "avian", 170));
});

test("Pet Showdown selects stable per-pet takes", () => {
        assert.equal(showdownPerformanceVariant("red-fox"), showdownPerformanceVariant("red-fox"));
        assert.ok([0, 1, 2].includes(showdownPerformanceVariant("moon-serpent")));
});

test("Pet Showdown reserves the strongest lens and timing response for a finisher", () => {
        const normal = showdownCinematicImpulse({ damageFraction: 0.12, superMove: false, killingBlow: false, lightning: false });
        const finisher = showdownCinematicImpulse({ damageFraction: 0.5, superMove: true, killingBlow: true, lightning: false });
        assert.ok(finisher.lensDegrees > normal.lensDegrees);
        assert.ok(finisher.hitStopMs > normal.hitStopMs);
        assert.ok(finisher.slowScale < normal.slowScale);
});
