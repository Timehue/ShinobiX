// AUTO-EXTRACTED from the Hollow Gate reference painting (scripts: scratchpad/extract_mask.py).
//
// The source image is exactly x-symmetric. Store only the left half of each row
// as alternating zero/one run lengths, encoded as unsigned LEB128 bytes in
// base64. Reconstructing and mirroring it here preserves the original row-major
// 220x120 `"0"`/`"1"` string byte-for-byte while avoiding a 26,400-byte literal
// in every production bundle that imports the Warfront map.
export const WF_BAKED_COLS = 220;
export const WF_BAKED_ROWS = 120;

const WF_BAKED_HALF_COLS = WF_BAKED_COLS / 2;
const WF_BAKED_HALF_LENGTH = WF_BAKED_HALF_COLS * WF_BAKED_ROWS;

// First run is zeroes; each completed varint flips the bit for the next run.
const WF_BAKED_HALF_RLE_BASE64 =
    "hAUCUAIUAgMETgYFCQEMTCdGK0IgAwpAIQQKOhUJCQMLOBEPCAQKNxESBQcINhIiBTQJBAYkAzIGCgZWBwwFVAQCAhADUAUXAk8F" +
    "GgIDAQMCGQEpBRsOFQIoBRwPFAIeDhwREwIdDR8QEgMcDh8IAgYSAxwOHwUIAxIDHA0gBAoBEwMcCyIFCAITAxsLIwUIAhQCGgwj" +
    "BgYDEwMZCCgPEQUXCQ4CGRAPBhYJDgQJAg0RDgYVCA0HCQENBAIGAwQMBhQJDQcXBAQFBAUHChIJDgUQAgYFBAQGBgQLEAkQBBEC" +
    "BgQPCwQGDwkQBREBBgUQCgYEDwgRBRgEEggIAw4IEwQYBBIICgEKDBMEFwUSCBQNFAMXBREJFAwVAxYFDwgBAhQNFQQUBQ8IFw4W" +
    "BREGDwgYBgIFFwcMBxAIGgIFBhYWEwciBxYDAQ8UAwICGwEIBxoLGAEcBQgJGAogAxIFCgkXCh4GEAUMCRQNHAcQBA4KEQ8CAhYD" +
    "AQQPBA8MBQIHFQcECAkQAxENAgMDJQYKDwMVDAUmBgoPAxUNAygFCg8DEzkHCQ4EEQsELAsFDgUOCxEUGQUNBQIBCgoUDh0HDQUB" +
    "AQkKFgsfCA0DDAcaCSEIGwUdCCIIBgMRBB4IIgcGBBEEHggdBgwEDwUdCxoIDQMHAgQHGBICAhMIFwQDBBkJBgwQCBcEAwMZBQwM" +
    "EAgXAwMDFwYPChIHFgMDAxYGFAYTBwoECAMCAxUFFwUUCQcECAMCAxUEGAUVCQcDCAMCBBQDGgQWCAcDCQMBBhEEGgUVCAYECgIC" +
    "Bg8FGgUUCQYECgIDBQ8FGgYSCgUFCQMDBBEFGQYRBgMBAwgIBQIEEgUYBwMCCgYICAgGAgUQBRkGDgUMBggPDgUZBwUCBgQOBQkG" +
    "AQgKAQMFGQYEBAQEEAQKBgEIBQUEAxsGAgQDBBIECwYBCAIGBgIbDQEEEwQMBQINCQIaERQEDQUBDAoDGQYCCRQEDgUBCgwDGQUG" +
    "BRUDDgYBCgwBGgQHBRYCDgYCCiUFAgoWAg4GAgskBQEKFgMOBQMMIwUBChYDDwMDBAMHIgcFBBYDFQQDCCEHBgMWAxUEAwghBwcB" +
    "GAIUER8HIQIUEh0IIQIVBgQIGwkhAhYFBQoXBgEDIQElBxUFJQMnBxIFIgMBASsGEAUVAwoGLAwIBRUGBwguCgUHEwoCCy8KAwgS" +
    "GDEUEBkyFwQGARozOjUKASk8BwMnPwYBI0UoRwoDGUsGCgsDBMkD";

function decodeBakedHalfMask(encoded: string): string {
    const bytes = atob(encoded);
    let half = "";
    let bit = "0";
    let run = 0;
    let shift = 0;

    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes.charCodeAt(i);
        run |= (byte & 0x7f) << shift;
        if ((byte & 0x80) !== 0) {
            shift += 7;
            continue;
        }

        half += bit.repeat(run);
        bit = bit === "0" ? "1" : "0";
        run = 0;
        shift = 0;
    }

    if (shift !== 0 || half.length !== WF_BAKED_HALF_LENGTH) {
        throw new Error(`Invalid baked Warfront mask (${half.length}/${WF_BAKED_HALF_LENGTH} half cells)`);
    }
    return half;
}

function expandBakedMask(): string {
    const half = decodeBakedHalfMask(WF_BAKED_HALF_RLE_BASE64);
    let mask = "";
    for (let row = 0; row < WF_BAKED_ROWS; row++) {
        const left = half.slice(row * WF_BAKED_HALF_COLS, (row + 1) * WF_BAKED_HALF_COLS);
        mask += left + left.split("").reverse().join("");
    }
    return mask;
}

export const WF_BAKED_MASK: string = expandBakedMask();
