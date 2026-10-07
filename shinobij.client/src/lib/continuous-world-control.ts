type Destination = { sector: number; tile: number };
let active: ((destination: Destination) => void) | undefined;
export function isContinuousWorldControlActive() { return active !== undefined; }
export function bindContinuousWorldControl(control: (destination: Destination) => void) {
    active = control;
    return () => { if (active === control) active = undefined; };
}
export function requestContinuousWorldWalk(sector: number, tile: number) {
    if (!active) return false;
    active({ sector, tile }); return true;
}
