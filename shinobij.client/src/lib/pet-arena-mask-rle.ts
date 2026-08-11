/**
 * Expand a baked pet-arena walkability mask from alternating unsigned-LEB128
 * run lengths. The generator stores those bytes as base64 so large `0`/`1`
 * grids do not occupy one JavaScript byte per cell in production bundles.
 */
export function decodePetArenaMaskRle(encoded: string, expectedLength: number, firstBit: "0" | "1"): string {
    const bytes = atob(encoded);
    let mask = "";
    let bit: "0" | "1" = firstBit;
    let run = 0;
    let shift = 0;

    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes.charCodeAt(i);
        run |= (byte & 0x7f) << shift;
        if ((byte & 0x80) !== 0) {
            shift += 7;
            continue;
        }

        mask += bit.repeat(run);
        bit = bit === "0" ? "1" : "0";
        run = 0;
        shift = 0;
    }

    if (shift !== 0 || mask.length !== expectedLength) {
        throw new Error(`Invalid pet-arena mask (${mask.length}/${expectedLength} cells)`);
    }
    return mask;
}
