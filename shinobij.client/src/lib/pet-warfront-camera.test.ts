import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Vector3 } from "three";
import { warfrontCameraFrame, warfrontCanvasFrame } from "./pet-warfront-camera";

test("the complete board and standing models fit desktop, tablet, phone and landscape phone", () => {
    for (const [width, height] of [[1416, 714], [796, 994], [378, 610], [400, 681], [832, 237]]) {
        const halfX = 11.4 * 0.7 + 1.2;
        const halfZ = 7.2 * 0.7 + 1.2;
        const frame = warfrontCameraFrame(width, height, halfX, halfZ);
        assert.deepEqual(frame.target, [0, 1, 0], "resizing must keep the camera centered on the board");
        const camera = new PerspectiveCamera(frame.fov, width / height, 0.1, frame.far);
        camera.position.set(...frame.position);
        camera.lookAt(...frame.target);
        camera.updateMatrixWorld();
        for (const x of [-halfX, 0, halfX]) for (const z of [-halfZ, 0, halfZ]) for (const y of [0, 1.95, 3.4]) {
            const point = new Vector3(x, y, z).project(camera);
            assert.ok(Math.abs(point.x) <= 0.94001 && Math.abs(point.y) <= 0.94001,
                `${width}×${height} clipped ${x}, ${y}, ${z}: ${point.toArray()}`);
            assert.ok(point.z > -1 && point.z < 1);
        }
    }
});

test("the Canvas fallback keeps edge pets, heads, and health rails inside the stage", () => {
    for (const [width, height] of [[1416, 714], [796, 994], [378, 610], [400, 681], [832, 237]]) {
        const frame = warfrontCanvasFrame(width, height, 11.4, 7.2);
        for (const x of [-11.4, 11.4]) for (const z of [-7.2, 7.2]) {
            const px = frame.centerX + x * frame.xScale;
            const py = frame.centerY + z * frame.zScale;
            assert.ok(px - frame.actorSize * 0.65 >= 9 && px + frame.actorSize * 0.65 <= width - 9);
            assert.ok(py - frame.actorSize * 0.95 >= 15 && py + frame.actorSize * 0.3 <= height - 9);
        }
    }
});
