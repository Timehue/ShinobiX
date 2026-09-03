// Derives collision masks for the Gateworks buildings from their own art, using
// the exact sampling the first-pact-world mask contract uses, then frees the
// south row as the authored threshold the maintenance street serves.
import sharp from "sharp";
import { resolve } from "node:path";

const SAMPLE = 16;
const buildings = [
    { id: "gateworks-engine-hall", file: "engine-hall.png", w: 7, h: 8 },
    { id: "gateworks-pump-house", file: "pump-house.png", w: 7, h: 6 },
    { id: "gateworks-keeper-rowhouse", file: "keeper-rowhouse.png", w: 3, h: 6 },
    { id: "gateworks-maintenance-shed", file: "maintenance-shed.png", w: 6, h: 4 },
    { id: "gateworks-valve-house", file: "valve-house.png", w: 4, h: 4 },
    { id: "arrival-gate", file: "arrival-gate.png", w: 9, h: 5 },
    { id: "boundary-lantern", file: "boundary-lantern.png", w: 1, h: 2 },
    { id: "boundary-stele", file: "boundary-stele.png", w: 1, h: 2 },
];

for (const b of buildings) {
    const { data, info } = await sharp(resolve(`src/assets/first-pact/gateworks-v2/${b.file}`))
        .resize(b.w * SAMPLE, b.h * SAMPLE, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const rows = [];
    for (let tileY = 0; tileY < b.h; tileY++) {
        let row = "";
        for (let tileX = 0; tileX < b.w; tileX++) {
            let opaque = 0;
            for (let py = 5; py < 11; py++) {
                for (let px = 5; px < 11; px++) {
                    const off = (((tileY * SAMPLE + py) * info.width) + (tileX * SAMPLE + px)) * info.channels;
                    if (data[off + 3] > 80) opaque++;
                }
            }
            row += opaque / 36 > 0.18 ? "#" : ".";
        }
        rows.push(row);
    }
    // The south row is the doorstep. Art covers it, but a building whose own
    // threshold is blocked cannot be entered from the street.
    rows[rows.length - 1] = ".".repeat(b.w);
    console.log(`${b.id}: ${JSON.stringify(rows)}`);
}
