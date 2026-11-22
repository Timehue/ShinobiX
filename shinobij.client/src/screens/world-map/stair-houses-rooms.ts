import type { CoastFloor } from "../../../../shared/coast-world-rules";

export const SHOP = "Provisions shop", KITCHEN = "Cook house", DEN = "Noodle Den";
export type Door = typeof SHOP | typeof KITCHEN | typeof DEN;
type Spot = { place: Door | "Street"; feet: [number, number]; approach: number; seatedArt?: string };
// The anchor is the floor or cushion contact in painting percentages. The approach is a walkable speaking tile.
export const residentSpots: Record<string, Spot> = {
    "A woman at her door": { place: "Street", feet: [71.5, 28.9], approach: 54 },
    "An old man on the stair": { place: "Street", feet: [53, 73.8], approach: 91 },
    "A water carrier": { place: "Street", feet: [24.7, 70.5], approach: 85 },
    "A cook carrying salt": { place: KITCHEN, feet: [34.8, 48], approach: 93 },
    "A man mending a roof": { place: SHOP, feet: [78, 48.5], approach: 98 },
    "A woman sitting apart": { place: DEN, feet: [13.1, 35.2], approach: 68, seatedArt: "/coast-map/residents/gambler-seated-v1.webp" },
};
export const street: CoastFloor = {
    title: "The Stair Houses", art: "saltstair-landing/scenes/stair-houses-street-v1.webp", spawn: 126, doors: [137, 138], stairs: [],
    mask: ["############","############","#########.##","###.......##","####....####","####...#####",
        "#.........##","#.#.......##","#..##..#####","#####..#####","#####..#####","#####..#####"],
    stations: [
        { name: SHOP, approach: 74, target: [1.8,4.7,2,1.3], detail: "" },
        { name: KITCHEN, approach: 42, target: [5,2,2,1.3], detail: "" },
        { name: DEN, approach: 81, target: [8.1,4.7,2,1.3], detail: "" },
    ],
};
export const shop: CoastFloor = {
    title: SHOP, art: "saltstair-landing/interiors/stair-houses-store-v1.webp", spawn: 126, doors: [137,138], stairs: [],
    mask: ["############","############","############","############","##........##","##........##",
        "##........##","##........##","##.........#","#..........#","#..........#","#####..#####"],
    stations: [{ name: "Browse provisions", approach: 54, target: [4,2.5,4,1.5], detail: "" }],
};
export const den: CoastFloor = {
    title: DEN, art: "saltstair-landing/interiors/stair-houses-den-v1.webp", spawn: 126, doors: [137,138], stairs: [],
    mask: ["############","############","############","############","###......###","##.......###",
        "#.......####","#.......####","#.......####","#.......####","#..........#","#####..#####"],
    stations: [{ name: "Order noodles", approach: 54, target: [4,2.5,4,1.5], detail: "" }],
};

