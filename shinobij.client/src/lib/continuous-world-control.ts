type Destination = { sector: number; tile: number; arrived?: () => void };
let active: ((destination: Destination) => void) | undefined;
export function isContinuousWorldControlActive() { return active !== undefined; }
export function bindContinuousWorldControl(control: (destination: Destination) => void) {
    active = control;
    return () => { if (active === control) active = undefined; };
}
export function requestContinuousWorldWalk(sector: number, tile: number, arrived?: () => void) {
    if (!active) return false;
    active({ sector, tile, arrived }); return true;
}
