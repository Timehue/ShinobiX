/** Local, optional accounts. These describe the public frontage and never
 * supply missing campaign witnesses or overwrite a character's story choices. */
export type BuildingInvestigation = {
    title: string;
    evidence: readonly { label: string; description: string }[];
    testimony: string;
    account: string;
    question: string;
};
export const BUILDING_INVESTIGATIONS: Readonly<Record<string, BuildingInvestigation>> = {
    gorgewatch: {
        title: 'The tower that kept a crossing',
        evidence: [
            {label:'Read the low signal grooves',description:'Two grooves survive beside the public threshold. Their edges are polished where a cord has passed; the broken upper tower cannot establish how the original signal sounded.'},
            {label:'Examine the replacement brace',description:'A newer brace crosses the old socket. Its cut stops short of the walking surface: the repair kept the approach open while the tower remained damaged.'},
            {label:'Compare the watcher’s slate',description:'The duty slate names crossing checks, not battles won. Compare its list of footing, marker and return signal with the two surviving fittings.'},
        ],
        testimony:'Jun: “I can answer for the checks made on my watch. I was not here when the upper tower broke. Write that boundary into your account.”',
        account:'The lower signal fittings and a replacement brace show successive use of the public crossing. The present watch keeps a three-part inspection slate while the upper tower remains damaged.',
        question:'Who worked the signal before the present watch? Neither the surviving fittings nor Jun’s slate names them.',
    },
    'esplanade-record-house': {
        title: 'A register beneath fallen tiles',
        evidence: [
            {label:'Trace the surviving shelf marks',description:'Short horizontal cuts in the sheltered wall match the spacing of narrow record trays. The marks locate storage; they do not identify every document once kept here.'},
            {label:'Compare the two roof tiles',description:'A glazed tile and a later plain replacement lie beside the sorting board. Their differing edges support more than one repair, without dating the collapse.'},
            {label:'Read Chise’s sorting labels',description:'Chise has separated legible place names from incomplete strokes. Unreadable fragments stay in an unassigned tray rather than receiving invented names.'},
        ],
        testimony:'Chise: “The fragments belong to a neighborhood register. I preserve what can still be read. An empty line is more honest than a name supplied for the sake of a complete page.”',
        account:'Shelf cuts, mixed replacement tiles and the field scribe’s sorted fragments identify a repeatedly maintained record frontage. Legible entries are copied separately from unresolved fragments.',
        question:'Which households used the unassigned tray’s fragments? No surviving complete entry connects those strokes to a name.',
    },
    'grey-landing-relay': {
        title: 'The landing’s second use',
        evidence: [
            {label:'Examine the worn letter ledge',description:'A flat stone at the western threshold has a smooth center and chipped edges. It can support a desk today; wear alone cannot prove who used it first.'},
            {label:'Compare old and new lashings',description:'Old fixing holes stand beside the new relay awning’s lashings. Hiro’s crew uses the standing frontage without presenting the new shelter as an intact old house.'},
            {label:'Read the first receiving stamp',description:'The present receiving book begins with a new clerk’s stamp. Its dates cover this relay’s current service, not the entire history of the landing.'},
        ],
        testimony:'Hiro: “A letter can pass safely through a damaged place. My stamp promises this desk received it. It promises nothing about the people who lived behind these walls.”',
        account:'The western frontage now supports a staffed relay desk under a lashed awning. The current receiving book distinguishes the resumed service from the roofless houses around it.',
        question:'What occupied the frontage before the first surviving receiving stamp? The present relay book does not reach that far back.',
    },
    'grey-landing-memorial': {
        title: 'Names and the spaces between them',
        evidence: [
            {label:'Read the recut stone margin',description:'A shallow old stroke remains beside a deeper recut letter. A name was maintained here; the depth of a cut does not establish the named person’s fate.'},
            {label:'Inspect the enclosure’s empty base',description:'An empty footing interrupts the line of stones. Record the missing position without supplying a lost inscription or treating absence as a death record.'},
            {label:'Compare Sena’s copy sheet',description:'Sena’s sheet preserves readable letters and marks damaged stretches with gaps. Its margins distinguish copied words from later travelers’ stories.'},
        ],
        testimony:'Sena: “People arrive wanting the stones to settle a story. I can show them a readable name. I cannot turn a damaged space into an answer about a life.”',
        account:'The enclosure contains maintained inscriptions, a missing stone position and a keeper’s gap-marked copies. The record preserves readable names without inferring the fate of their bearers.',
        question:'What stood on the empty base, and why was it removed? The remaining stones and copy sheet cannot answer.',
    },
    'obsidian-waystation': {
        title: 'A return route through the ash',
        evidence: [
            {label:'Inspect the sheltered route mark',description:'A return arrow survives below the broken banner wall, sheltered from the prevailing ash. Its low placement makes it readable from the open approach.'},
            {label:'Compare the cleared and buried joints',description:'Ash fills an unused wall joint while the nearby public threshold has been swept. The difference establishes current maintenance, not the date of the wall’s damage.'},
            {label:'Read En’s return tally',description:'En’s tally counts reports returned to this post. It records the part of the road someone checked; blank space beyond the last mark remains unverified.'},
        ],
        testimony:'En: “I mark the road back. An arrow is a direction, not a promise that every path ahead is safe. Leave the unchecked stretch blank.”',
        account:'A sheltered return mark, a swept threshold and the watcher’s bounded tally show an active road station within broken walls. Its reports describe checked approaches and preserve the limits of each observation.',
        question:'Which earlier crew set the sheltered arrow? The current tally begins after its cutting and does not identify them.',
    },
};

export type FestivalTask = { choice: string; label: string; instruction: string };
const performer: readonly FestivalTask[] = [
    {choice:'bow',label:'Bow',instruction:'Begin with a bow to acknowledge the next group.'},
    {choice:'left',label:'Step left',instruction:'Move left within the rehearsal space, keeping the public approach clear.'},
    {choice:'right',label:'Step right',instruction:'Return right with the guide’s answering step.'},
    {choice:'bow',label:'Bow',instruction:'Close with a bow and clear the practice space for the next group.'},
];
export function buildingFestivalTasks(id:string):readonly FestivalTask[]{
    if(id==='festival-welcome')return [
        {choice:'receive',label:'Receive the arriving group',instruction:'Nao lends you the arrival slate. Acknowledge the arriving practice group before giving directions.'},
        {choice:'count',label:'Confirm the party count',instruction:'Match the practice group’s count to the slate so nobody is sent ahead alone.'},
        {choice:'direct',label:'Explain the Cactus Flats entrance',instruction:'Point out the established Sunscar entrance at Cactus Flats, Sector 54. Festival entry uses that entrance’s existing admission rules.'},
        {choice:'return',label:'Return the arrival slate',instruction:'Return Nao’s slate and leave the public speaking window open for actual arrivals.'},
    ];
    if(id==='festival-lantern-house')return [
        {choice:'frame',label:'Inspect the practice frame',instruction:'Fumi supplies a reusable practice frame. Check its joints before stretching the borrowed cover; your inventory is untouched.'},
        {choice:'fit',label:'Dry-fit the cover',instruction:'Fit the borrowed cover loosely so the seam lies clear of the hanging loop.'},
        {choice:'bind',label:'Bind the hanging loop',instruction:'Tie the practice loop above the frame, leaving the cover loose enough to remove.'},
        {choice:'test',label:'Test and return the lantern',instruction:'Hang the unlit practice lantern at the counter, then return the frame and cover to Fumi. This is preparation practice; repair commissions supply actual consumed materials.'},
    ];
    return performer;
}

export const CONTACT_PROTOCOLS = {
    cedar:{mark:'a split cedar stroke',label:'Use the lower shutter'},
    reed:{mark:'three reed strokes',label:'Use the side letter slot'},
    stone:{mark:'a hollow stone circle',label:'Use the speaking window'},
} as const;
export type ContactProtocol = keyof typeof CONTACT_PROTOCOLS;
/** The server seals a bounded protocol at admission; reconnects keep that order. */
export function buildingContactProtocol(id:string,now:number):ContactProtocol{
    const offset=[...id].reduce((sum,char)=>sum+char.charCodeAt(0),0);
    return (['cedar','reed','stone'] as const)[(Math.floor(now/3_600_000)+offset)%3];
}
