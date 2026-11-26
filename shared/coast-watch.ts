/** The same Reedwatch order is flown above the rise and followed at the quay. */
export const COAST_WATCHES = {
    'brackwater-counter-118': {
        sectors: [116, 118], orders: ['Clear channel', 'Hold offshore', 'Berth at the quay'],
        reports: ['One pennant flies. The skiff is coming through the channel.', 'Crossed pennants hold the skiff off the quay.', 'A split-tail pennant brings the skiff alongside to unload.'],
    },
    'whitecrown-fort-138': {
        sectors: [138], orders: ['Road open', 'Wait at the gate', 'Fog passage'],
        reports: ['A white lamp shows the road is open.', 'An amber lamp holds carts below the gate.', 'Both shutters stand open. The road crew follows the broad beam through the fog.'],
    },
    'hushcrown-fort-150': {
        sectors: [150], orders: ['Reed watch', 'Stone watch', 'Joint watch'],
        reports: ['The reed banner hangs above the gate.', 'The stone banner marks the relief on duty.', 'The spliced banner flies for the two watches on duty together.'],
    },
} as const;
export type CoastWatch = keyof typeof COAST_WATCHES;
export function watchForSector(sector: number): CoastWatch | undefined {
    return (Object.keys(COAST_WATCHES) as CoastWatch[]).find(id => COAST_WATCHES[id].sectors.some(at => at === sector));
}
