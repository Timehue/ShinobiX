import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { warfrontCameraFrame, warfrontCanvasFrame } from "./pet-warfront-camera";

const cameraAt = (width: number, height: number) => {
    const frame = warfrontCameraFrame(width, height, 11.4 * .7, 7.2 * .7);
    const camera = new PerspectiveCamera(frame.fov, width / height, .1, frame.far);
    camera.position.set(...frame.position); camera.lookAt(...frame.target);
    camera.updateMatrixWorld(); camera.projectionMatrix.elements[5] *= frame.verticalScale; camera.projectionMatrix.elements[9] -= frame.shiftY;
    if (frame.orthographic) {
        const { halfWidth, halfHeight } = frame.orthographic;
        camera.projectionMatrix.makeOrthographic(-halfWidth, halfWidth, halfHeight, -halfHeight, .1, frame.far);
        camera.projectionMatrix.elements[13] = .044;
    }
    return camera;
};
// Measured vertices of the painted landscape floor, not a rectangle inferred
// from the renderer. A previous frustum-only test missed pets walking on roofs.
const floor = [[630,155],[1450,369],[1250,849],[217,432]].map(([x,y])=>[x*1280/1672,y*720/941]);
const insideFloor = (x: number, y: number) => floor.every(([ax,ay], i) => {
    const [bx,by] = floor[(i + 1) % floor.length];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
});

test("all 35 collision cells sit on the painted court in both desktop renderers", () => {
    for (const [width,height] of [[1280,720],[1440,900],[1818,950]]) {
        const camera = cameraAt(width,height);
        const canvas = warfrontCanvasFrame(width,height,11.4,7.2);
        const scale = Math.max(width / 1280, height / 720);
        let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
        for (let row=0;row<5;row++) for (let col=0;col<7;col++) {
            const x=(col-3)*3.2, z=(row-2)*3;
            const point = new Vector3(x*.7,0,z*.7).project(camera);
            const px=(point.x+1)*width/2, py=(1-point.y)*height/2;
            const artX=(px+(1280*scale-width)/2)/scale;
            const artY=(py+(720*scale-height)/2)/scale;
            assert.ok(insideFloor(artX,artY), `cell ${col},${row} left painted slate at ${artX},${artY}`);
            const fallback=canvas.project(x,z);
            assert.ok(Math.hypot(px-fallback[0],py-fallback[1])<.001, "renderer switches must not move the ground");
            minY=Math.min(minY,artY);maxY=Math.max(maxY,artY);minX=Math.min(minX,artX);maxX=Math.max(maxX,artX);
        }
        assert.ok(maxY-minY>320 && maxX-minX>550, "playable cells must span the upper, lower and side lanes");
    }
});

test("phone ground positions remain on the portrait floor with room for heads and tails", () => {
    for (const [width,height] of [[390,844],[430,932],[820,1180]]) {
        const frame=warfrontCanvasFrame(width,height,11.4,7.2);
        const camera=cameraAt(width,height);
        for(let row=0;row<5;row++) for(let col=0;col<7;col++) {
            const x=(col-3)*3.2, z=(row-2)*3;
            const p=new Vector3(x*.7,0,z*.7).project(camera);
            const [px,py]=frame.project(x,z);
            assert.ok(Math.hypot((p.x+1)*width/2-px,(1-p.y)*height/2-py)<.001,
                "portrait renderer switches must preserve terrain registration");
        }
        for (const x of [-9.6,9.6]) for (const z of [-6,6]) {
            const [px,py]=frame.project(x,z);
            assert.ok(px>width*.18 && px<width*.82);
            assert.ok(py>height*.30 && py<height*.66);
            assert.ok(py-frame.actorSize>height*.16 && py+frame.actorSize*.3<height*.75);
        }
    }
});

test("rotated phones retain every lane below the compact HUD", () => {
    for(const [width,height] of [[844,390],[1040,480]]) {
        const camera=cameraAt(width,height);
        for(const x of [-9.6,9.6]) for(const z of [-6,6]) for(const y of [0,2.5]) {
            const p=new Vector3(x*.7,y,z*.7).project(camera);
            const py=(1-p.y)*height/2;
            assert.ok(py>145 && py<height-15, `${width}x${height}: a pet leaves the HUD-safe garden`);
        }
    }
});
