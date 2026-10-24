/** Every tile a sector-life resident rests, works or waits on, by sector.
 *
 * The cast itself is built on the server from sector-life.ts, which is far too
 * large to ship to the browser for a lookup. Story and quest NPCs are placed in
 * the browser, so they read this snapshot to stay off residents' tiles.
 * sector-life-standing.test.ts rebuilds it from the real cast and prints the
 * replacement whenever residents move.
 *
 * Sectors 1, 2, 3… are comma-separated in order. Each tile is two base-36
 * digits ("1o" is 60), which keeps the table near half the size of an array
 * literal on a bundle with little room left. */
export const LIFE_STANDING_CODES = '05181o2t2u2w37,05060h0i1n1x1z2h2s35,1o1z2232343d,05060x0y0z1m1o1v2a,1g1o3f3q3s3t,1i1o1z2s2v34,041n1q1s1u1z,04051j3738393k,04050q0s141n1z21222k2r2t2u3j3m,090e0h0s1e1f1s1z3t,0u1o1z32333435363q3t,181o1z2g2j3g3i3j3k,02121415161o1q1t3t,03051e1f1g1h1i1o2528,1o2s2w2x333438393f3g,051z242h2k3i3j3l3u,051c2e2u353i,161o1z2v2y37,0y1o1z36383a,0l1o1z2x3k3m,041416181o3s,050n1o2v2x2z,050f1o1s212p2s3e3h,04051b1y1z25263j3l3n,0304051t2426,1c212s2u35,05061a1v1x,1z3a3g3k,0s181l1o,04191k1m2i,141o1p1y1z2j2p2u3d3g3h3i3j,04051u282a,0509191k,031c1o1t2426,03051i1n1t26,0m1o1t1v1z20232526,050e14171i1o1t26,050p1i1o1t262s2v,05071o1t1v202326,051n1o1t1v202326,0m14171c1v1z2628,1o1p1s1y1z2h2i2r3234373h3j3s3t3u,050e1c1i1v24262r2u,1n1o1s1v2133363a3e3t3w,030514171i1o1t26,0g1o1p1t1v1y1z232426,031i1o1t1z26,0304051i1t26,040t1c1v26282i,04050e1i1m1n1r1s1t2627,031i1o1t1z2627,03040506071t2g2h2k2w,03051t26,,0k1i1n1o1t1y262h,050d0g0i0l12161u1z,0x1i1o1t263s,031i1n1t1z26,051o1t1v1z26,051c1i1n1v26,051a1i1t1u1z262s2v,050g15181u1v262h3t,050g1v26,051o1t1v1z26,040i1i2628,0i1c24262h3t';

export const lifeStandingTiles = (sector: number): readonly number[] =>
    LIFE_STANDING_CODES.split(',')[sector - 1]?.match(/../g)?.map((code) => parseInt(code, 36)) ?? [];
