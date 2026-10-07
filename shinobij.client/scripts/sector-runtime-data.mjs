/** Keep authoring diagnostics in the canonical file, outside the browser bundle. */
export function sectorRuntimeData(source) {
    const data = JSON.parse(source);
    for (const layout of Object.values(data.layouts)) {
        // Names come from sector-geo; roads come from sector-links. Hydrology is
        // an art-review input. Runtime collision and landmark records stay exact.
        delete layout.name;
        delete layout.exits;
        delete layout.hydrology;
    }
    return JSON.stringify(data);
}
