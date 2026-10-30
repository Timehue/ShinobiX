/** Authored environment plates and their solid silhouettes. These masks are
 * depth surfaces, not decoration: both renderers use them to hide a pet passing
 * behind a planted island or terrace wall. Coordinates are source-image pixels. */
export const WARFRONT_GARDEN_ART = {
    landscape: "/assets/warfront/training-garden-v1-landscape.webp",
    portrait: "/assets/warfront/training-garden-v1-portrait.webp",
} as const;
type Polygon = readonly (readonly [number, number])[];
export const GARDEN_MASKS: Readonly<Record<"landscape" | "portrait", Readonly<Record<string, readonly Polygon[]>>>> = {
    landscape: {
        "3:1": [[[817,357],[841,337],[854,323],[864,298],[873,283],[884,289],[890,315],[901,308],[914,318],[920,336],[952,334],[964,347],[916,386]]],
        "3:3": [[[699,482],[736,455],[746,444],[761,423],[779,428],[786,404],[798,396],[810,414],[814,447],[837,449],[875,463],[811,523]]],
        "2:0": [[[779,264],[793,248],[814,256],[805,276]],[[814,238],[824,220],[845,228],[836,247]],[[869,248],[882,235],[902,242],[891,260]],[[840,282],[850,267],[871,276],[861,295]]],
        "4:4": [[[752,613],[763,593],[788,606],[777,625]],[[813,546],[824,525],[850,536],[840,561]],[[887,577],[896,553],[920,567],[911,592]],[[839,641],[849,615],[874,630],[863,654]]],
    },
    portrait: {
        "3:1": [[[377,799],[377,691],[394,686],[402,676],[410,670],[418,677],[424,668],[434,682],[440,708],[452,731],[464,741],[464,800]]],
        "3:3": [[[379,1126],[379,1028],[392,1021],[402,996],[415,991],[426,1008],[437,1003],[449,1030],[462,1054],[464,1126]]],
        "2:0": [[[298,521],[320,517],[320,566],[300,569]],[[347,520],[372,525],[375,569],[352,566]],[[298,600],[320,599],[323,640],[300,645]],[[348,600],[374,599],[377,643],[348,646]]],
        "4:4": [[[470,1131],[494,1125],[494,1176],[471,1176]],[[526,1133],[548,1136],[551,1181],[527,1179]],[[469,1225],[492,1224],[495,1270],[470,1277]],[[529,1229],[552,1228],[555,1276],[530,1282]]],
    },
};

export function gardenImageFrame(width: number, height: number) {
    const portrait = height > width;
    const sourceWidth = portrait ? 841 : 1672, sourceHeight = portrait ? 1870 : 941;
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    // The portrait floor is deliberately elongated to preserve readable pets.
    const short = !portrait && height <= 500;
    const drawHeight = portrait ? height : short ? height * .85 : sourceHeight * scale;
    const drawWidth = portrait ? width : sourceWidth / sourceHeight * drawHeight;
    return { portrait, sourceWidth, sourceHeight, x: (width-drawWidth)/2, y: (height-drawHeight)/2 + (short ? 90 : 0), width: drawWidth, height: drawHeight };
}
