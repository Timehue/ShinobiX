import { gardenImageFrame } from "./pet-warfront-garden";
/** Match the camera to the authored court, rather than fitting a board below
 * the HUD. These are the landscape painting's lens and floor orientation. */
const COURT_YAW = .5;
const COURT_ELEVATION = .85;
const COURT_DISTANCE = 28;
const COURT_FOV = 40;

export function warfrontCameraFrame(width: number, height: number, halfX: number, halfZ: number) {
    const portrait = height > width;
    const aspect = Math.max(.1, width / Math.max(1, height));
    const elevation = portrait ? 2 : COURT_ELEVATION;
    const yaw = portrait ? 0 : COURT_YAW;
    const cosPitch = 1 / Math.sqrt(1 + elevation * elevation);
    const sinPitch = elevation * cosPitch;
    // CSS background-size: cover crops the painting; apply that same crop to
    // the lens so resizing never slides the pets relative to the stone.
    const imageFrame = gardenImageFrame(width,height);
    const paintedHeight = imageFrame.height;
    const fov = portrait ? 50 : 2 * Math.atan(Math.tan(COURT_FOV * Math.PI / 360) * height / paintedHeight) * 180 / Math.PI;
    let distance = COURT_DISTANCE * halfX / (11.4 * .7);
    if (portrait) {
        const tanV = Math.tan(fov * Math.PI / 360) * .82;
        distance = Math.max(halfX / (tanV * aspect) + halfZ * cosPitch, halfZ / tanV);
    }
    return {
        fov,
        orthographic: portrait ? { halfWidth: halfX / .735, halfHeight: halfZ * sinPitch / .4 } : null,
        position: [Math.sin(yaw) * distance * cosPitch, distance * sinPitch, Math.cos(yaw) * distance * cosPitch] as [number, number, number],
        target: [0, 0, 0] as [number, number, number],
        shiftY: portrait ? -.12 : 1 - 2 * (imageFrame.y + paintedHeight * .4328) / height,
        verticalScale: portrait ? 1 : 1.13,
        far: Math.max(100, distance + halfX + halfZ + 10),
    };
}

/** Canvas uses the same landscape ground projection as Three. The portrait
 * painting has a taller floor, so its fallback spreads the rows along it. */
export function warfrontCanvasFrame(width: number, height: number, halfX: number, halfZ: number) {
    const portrait = height > width;
    const actorSize = Math.max(54, Math.min(portrait ? 128 : 140, Math.min(width, height) * .22 * 1.16));
    const centerX = width * .5;
    const centerY = height * .478;
    const xScale = width * .735 / (halfX * 2);
    const zScale = height * .40 / (halfZ * 2);
    const imageFrame = gardenImageFrame(width,height);
    const paintedHeight = imageFrame.height;
    const focal = paintedHeight / (2 * Math.tan(COURT_FOV * Math.PI / 360));
    const cosPitch = 1 / Math.sqrt(1 + COURT_ELEVATION ** 2);
    const sinPitch = COURT_ELEVATION * cosPitch;
    const project = (x: number, z: number): readonly [number, number] => {
        if (portrait) return [centerX + x * xScale, centerY + z * zScale];
        const right = (x * Math.cos(COURT_YAW) - z * Math.sin(COURT_YAW)) * .7;
        const along = (x * Math.sin(COURT_YAW) + z * Math.cos(COURT_YAW)) * .7;
        const depth = COURT_DISTANCE - along * cosPitch;
        return [centerX + right * focal / depth, imageFrame.y + paintedHeight * .4328 + along * sinPitch * focal * 1.13 / depth];
    };
    return { centerX, centerY, xScale, zScale, actorSize, project };
}
