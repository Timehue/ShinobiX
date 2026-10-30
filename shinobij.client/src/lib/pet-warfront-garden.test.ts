import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { GARDEN_MASKS, WARFRONT_GARDEN_ART } from "./pet-warfront-garden";
import { warfrontCanvasFrame } from "./pet-warfront-camera";
import { WARFRONT_TERRAIN, warfrontTerrainPoint } from "./pet-warfront-contract";

test("both environment plates register their authored obstacles to the same collision cells", () => {
    const references = {
        landscape: { size: [1672,941], centers: [[890,354],[788,486],[840,263],[833,596]], tolerance: 14 },
        portrait: { size: [841,1870], centers: [[420,742],[420,1052],[337,583],[511,1205]], tolerance: 7 },
    } as const;
    for (const mode of ["landscape","portrait"] as const) {
        const {size,centers,tolerance}=references[mode];
        const frame=warfrontCanvasFrame(...size,11.4,7.2);
        const solid=WARFRONT_TERRAIN.filter(cell=>cell.kind!=="mist");
        assert.equal(Object.keys(GARDEN_MASKS[mode]).length,solid.length);
        solid.forEach((cell,index)=>{
            const [x,y]=frame.project(...warfrontTerrainPoint(cell.col,cell.row));
            assert.ok(Math.hypot(x-centers[index][0],y-centers[index][1])<tolerance,
                `${mode} ${cell.kind} at ${cell.col},${cell.row} detached from its painted foundation`);
            const polygons=GARDEN_MASKS[mode][`${cell.col}:${cell.row}`];
            assert.ok(polygons.length>0);
            for (const polygon of polygons) for(const [px,py] of polygon) {
                assert.ok(px>=0 && px<=size[0] && py>=0 && py<=size[1]);
            }
        });
        const file=readFileSync(new URL("../../public"+WARFRONT_GARDEN_ART[mode],import.meta.url));
        assert.equal(file.toString("ascii",8,12),"WEBP");
        assert.ok(file.length<200_000,"the authored arena must remain a small browser download");
    }
});
