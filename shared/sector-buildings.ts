import { SECTOR_FLOOR_LAYOUTS } from './sector-floor-layouts.js';
import { SECTOR_PLACES, sectorRegionLabel, sectorPlace } from './sector-geo.js';
import { SHRINE_DEFS } from './shrines.js';
import { nearestWalkableTile, pathInMask, sectorWalkMask } from './sector-walk-mask.js';
import type { BuildingPoint, BuildingService, SectorBuilding } from './sector-building-types.js';
import { BUILDING_INVESTIGATIONS } from './sector-building-stories.js';
import { lifeResidentName } from './sector-life-content.js';

const owners: Readonly<Record<string, string>> = { stormveil: 'Stormveil Village', ashenleaf: 'Ashen Leaf Village', moonshadow: 'Moonshadow Village', frostfang: 'Frostfang Village' };
const staff: Readonly<Record<string, readonly [string, string]>> = {
    stormveil: ['Quartermaster Ume', 'Harbor duty clerk'], ashenleaf: ['Warden Aki', 'Deepwood quartermaster'],
    moonshadow: ['Clerk Ren', 'Road trust registrar'], frostfang: ['Warden Eda', 'Winter supply clerk'], deathsgate: ['Watcher Seki', 'Obsidian gate watcher'],
};
const keeperNames:Readonly<Record<string,readonly string[]>>={stormveil:['Hina','Isao','Kiri','Nori','Riku','Sae','Toki','Yuna'],ashenleaf:['Aya','Bun','Chika','Dai','Eri','Fusa','Goro','Hana'],moonshadow:['Itsu','Jin','Kana','Maki','Rena','Sora','Tae','Yori'],frostfang:['Anri','Eiko','Haku','Kota','Mei','Natsu','Oto','Ryo']};
function keeperAt(sector:number,region:string){const names=keeperNames[region];return names?`${staff[region]![1]} ${names[SECTOR_PLACES.filter(p=>p.region===region).findIndex(p=>p.id===sector)%names.length]}`:(staff[region]?.[0]??'Duty Warden');}
const architecture: SectorBuilding[] = [];
for (const place of SECTOR_PLACES) {
    const layout = SECTOR_FLOOR_LAYOUTS[place.artKey];
    if (!layout) continue;
    const site = layout.sites.stronghold;
    if (site) {
        const [x, y, size] = site.footprint;
        const keeper=keeperAt(place.id,place.region),role=staff[place.region]?.[1]??'Road warden';
        architecture.push({ id: `stronghold-${place.id}`, sector: place.id, name: place.id === 99 ? 'Obsidian Stronghold' : `${place.name} Stronghold`,
            kind: 'stronghold', keeper, role, region: place.region, village: owners[place.region],
            description: place.id === 99 ? 'A watch house above the ash road. Its outer threshold is a place to ask about the return route; the chambers beyond remain dangerous.'
                : `The ${sectorRegionLabel(place.id)} duty house keeps a road register, a supply counter and the guarded approach to the stronghold below.`,
            services: ['reception', 'repair', 'workshop', ...([2, 8, 14, 16, 18, 24, 27, 31].includes(place.id) ? ['courier' as const] : [])],
            left: site.left, top: site.top, width: site.width, height: site.width,
            footprint: Array.from({ length: size * size }, (_, k) => (y + Math.floor(k / size)) * 12 + x + k % size), approach: site.approach,
            art: place.id===99?'frontier':place.region==='frostfang'?'gatehouse-winter':'gatehouse',
        });
    }
    if (layout.village) {
        const entry = layout.village, keeper=keeperAt(place.id,place.region);
        architecture.push({ id: `village-${place.id}`, sector: place.id, name: `${entry.name.replace(' Village', '')} Gatehouse`, kind: 'village',
            keeper, role: 'Village gate officer', description: 'A public speaking window stands outside the village gate. Travelers can ask for directions or leave a sealed letter with the officer.',
            services: ['reception', 'courier'], region: place.region, village: entry.name,
            left: entry.left, top: entry.top + entry.width / 2, width: entry.width, height: entry.width,
            footprint: Array.from({ length: 16 }, (_, k) => (4 + Math.floor(k / 4)) * 12 + 4 + k % 4), approach: entry.approach, art: place.region==='frostfang'?'gatehouse-winter':'gatehouse' });
    }
    const shrine = SHRINE_DEFS.find(s => s.sector === place.id), shrineSite = layout.sites.shrine;
    if (shrine && shrineSite) {
        const [x, y, size] = shrineSite.footprint;
        architecture.push({ id: `shrine-${shrine.id}`, sector: place.id, name: shrine.name, kind: 'shrine', keeper: `${shrine.name.replace(' Shrine', '')} Keeper`,
            role: 'Keeper of the register', description: shrine.lore, region: place.region, village: shrine.village, shrineId: shrine.id,
            services: ['register', ...(place.id===31 ? ['tea' as const] : [])], left: shrineSite.left, top: shrineSite.top,
            width: shrineSite.width, height: shrineSite.width, approach: shrineSite.approach,
            footprint: Array.from({ length: size * size }, (_, k) => (y + Math.floor(k / size)) * 12 + x + k % size), art: 'shrine' });
    }
}

type RoadBuilding = Omit<SectorBuilding, 'region' | 'footprint' | 'evidence' | 'watchPoints'> & { bounds?: readonly [number, number, number, number]; survey?: boolean; watch?: boolean };
function roadBuilding(def: RoadBuilding): SectorBuilding {
    const place = sectorPlace(def.sector)!;
    const mask = sectorWalkMask(def.sector)!;
    const bounds = def.bounds ?? [def.left - def.width / 2, def.top - def.height, def.width, def.height];
    const candidates = Array.from({ length: 144 }, (_, tile) => tile).filter(tile => {
        const x = (tile % 12 + .5) / 12 * 100, y = (Math.floor(tile / 12) + .5) / 12 * 100;
        return x >= bounds[0] && x <= bounds[0] + bounds[2] && y >= bounds[1] && y <= bounds[1] + bounds[3];
    });
    const approach = nearestWalkableTile(def.sector, def.approach);
    const solids=candidates.filter(tile=>'#B'.includes(mask[Math.floor(tile/12)][tile%12]));
    const footprint=solids.length?solids:[approach];
    const stops = Array.from({ length: 144 }, (_, tile) => ({ tile, path: pathInMask(mask, approach, tile) }))
        .filter(p => p.path && p.path.length >= 2 && p.path.length <= 5).sort((a,b) => a.path!.length - b.path!.length || a.tile-b.tile);
    const points = (labels: readonly string[]): BuildingPoint[] => labels.map((label, i) => ({ sector: def.sector,
        tile: i === 0 ? approach : stops[(i - 1) * Math.max(1, Math.floor(stops.length / 3))]?.tile ?? approach,
        label, description: `${label} at ${def.name}. Keep to the open approach; the standing masonry is not a walking route.` }));
    const { bounds: _bounds, survey, watch, ...rest } = def; void _bounds;
    const investigation=BUILDING_INVESTIGATIONS[def.id];
    const evidence=investigation?.evidence.map((entry,index)=>({...points(investigation.evidence.map(e=>e.label))[index],...entry}));
    const watchPoints=points(def.sector===38?['Check the bridge approach','Read the river-bank marker','Return to the signal window']:
        def.sector===27?['Check the snow-road approach','Read the winter route marker','Return to the watch keeper']:['Check the ash-road approach','Read the return marker','Return to the signal window']);
    watchPoints[2]={...watchPoints[2],tile:approach,description:'Return to the public threshold. File only the conditions observed during this round; a watch report does not guarantee the entire route is safe.'};
    return { ...rest, approach, footprint, region: place.region,
        ...(survey&&evidence ? { evidence } : {}),
        ...(watch ? { watchPoints } : {}),
        ...(rest.services.includes('intelligence')?{contactPoints:[{...points(['Observe the contact marker'])[0],tile:stops[Math.min(3,stops.length-1)]?.tile??approach},...points(['Read the entrusted seal','Make the agreed handoff']).map(p=>({...p,tile:approach}))]}:{}) };
}
const additions: RoadBuilding[] = [
    { id:'gorgewatch',sector:38,name:'Gorgewatch Post',kind:'ruin',keeper:'Watcher Jun',role:'Bridge watcher',description:'A damaged banner tower overlooks the gorge crossing. The watch works from the open threshold while its upper masonry is repaired.',services:['watch','repair','survey'],left:74,top:32,width:21,height:30,approach:44,art:'watchtower',survey:true,watch:true,
        restoredWatchPoint:{sector:38,tile:62,label:'Read the restored lookout signal',description:'Stand at the marked bridge crossing and confirm the restored post’s signal from this longer sightline. Report the observed sky and signal only; neither establishes that the unchecked road ahead is safe.'} },
    { id:'esplanade-record-house',sector:50,name:'Esplanade Record House',kind:'ruin',keeper:'Archivist Chise',role:'Chronicle field scribe',description:'Collapsed tiled roofs shelter fragments of an old neighborhood register. Chise records what witnesses can establish before repairs disturb the evidence.',services:['survey','repair','register'],left:25,top:84,width:42,height:34,approach:89,art:'archive',survey:true },
    { id:'esplanade-work-yard',sector:50,name:'Esplanade Repair Yard',kind:'ruin',keeper:'Carpenter Rin',role:'Public works keeper',description:'The eastern roofless frontage holds the work yard for repairs to the public shelters. Every material bundle is counted before work begins.',services:['repair','workshop'],left:81,top:79,width:28,height:35,approach:93,art:'workshop' },
    { id:'grey-landing-relay',sector:62,name:'Greycliff Relay House',kind:'ruin',keeper:'Relay Clerk Hiro',role:'Letter relay clerk',description:'The western roofless houses once served the landing road. A sheltered threshold now holds a letter desk and the restoration roll.',services:['courier','repair','survey'],left:28,top:71,width:29,height:40,approach:89,art:'courier',survey:true },
    { id:'grey-landing-memorial',sector:62,name:'Greycliff Witness Enclosure',kind:'ruin',keeper:'Keeper Sena',role:'Landing register keeper',description:'Carved stones stand inside a low ruined enclosure east of the road. The keeper separates names recorded here from stories that have no witness.',services:['register','survey','repair'],left:73,top:79,width:27,height:34,approach:93,art:'shrine',survey:true },
    { id:'obsidian-waystation',sector:60,name:'Obsidian Road Station',kind:'ruin',keeper:'Scout En',role:'Ash-road watcher',description:'Broken red-bannered walls mark a former road station. En keeps the return route open and repairs shelter for travelers crossing the ash.',services:['repair','survey','watch'],left:29,top:79,width:35,height:34,approach:78,art:'frontier',survey:true,watch:true },
    { id:'obsidian-north-watch',sector:60,name:'Obsidian North Watch',kind:'ruin',keeper:'Watch Clerk Ise',role:'Return-route clerk',description:'The northern tower fragments retain a sheltered speaking window. Watch reports are compared here before anyone is directed farther into the frontier.',services:['watch','repair'],left:23,top:31,width:36,height:30,approach:41,art:'frontier',watch:true },
    { id:'midlands-tea-house',sector:42,name:'Fieldside Tea House',kind:'workplace',keeper:lifeResidentName(42),role:'Tea-table host',description:'A kettle, mats and a Chronicle table make a public stop beside the herb rows. Players and their living companions can rest while the host compares road news.',services:['tea','courier','register'],left:26,top:84,width:26,height:18,approach:110,art:'teahouse' },
    { id:'heartwood-tea-counter',sector:15,name:'Ren’s Heartwood Tea Table',kind:'workplace',keeper:lifeResidentName(15),role:'Tea-table host and letter receiver',description:'The existing kettle table and woven mats stand beside the Heartwood road. Ren receives travelers here, while Tetsu keeps his own resting mat and carries letters onward on the established harbor–deepwood circuit.',services:['tea','courier','reception'],left:75.5,top:74,width:13,height:12,approach:116,art:'teahouse' },
    { id:'festival-welcome',sector:52,name:'Sunscar Welcome House',kind:'workplace',keeper:'Arrival Host Nao',role:'Festival arrival host',description:'The western red-bannered house receives arriving groups and points them toward the Sunscar entrance at Cactus Flats.',services:['reception','festival','courier'],left:17,top:34,width:26,height:30,approach:40,art:'festival' },
    { id:'festival-lantern-house',sector:52,name:'Sunscar Lantern House',kind:'workplace',keeper:'Lantern Maker Fumi',role:'Festival lantern maker',description:'The southern frontage stores fiber, frames and bowls for the festival. Public repairs and small preparation commissions keep the premises in use.',services:['repair','workshop','festival'],left:41,top:93,width:31,height:20,approach:113,art:'workshop' },
    { id:'festival-steps-house',sector:52,name:'Sunscar Performers’ House',kind:'workplace',keeper:'Performer Mina',role:'Festival rehearsal guide',description:'Performers prepare beside the southwestern house, then enter the existing public rehearsal square. Visitors can learn the steps without blocking the road.',services:['festival','reception'],left:18,top:78,width:28,height:25,approach:88,art:'festival' },
    { id:'festival-tea-counter',sector:52,name:`${lifeResidentName(52).split(' ').at(-1)}’s Festival Tea Counter`,kind:'workplace',keeper:lifeResidentName(52),role:'Festival tea seller',description:'The existing eastern counter serves bowls and tea. Its welcome remains available while rain or late hours keep the serving ledge covered.',services:['tea'],left:79,top:74,width:17,height:18,approach:104,art:'teahouse' },
    { id:'flower-pickers-shelter',sector:3,name:'Flower-Pickers’ Shelter',kind:'road-place',keeper:'Shelter Keeper Ume',role:'Public shelter keeper',description:'The flower pickers keep a roadside meeting point here. Their story with Mira remains their own; ordinary visitors can ask for shelter and help maintain the public rail.',services:['reception','repair'],left:37,top:68,width:11,height:10,approach:88,art:'gatehouse',storyPointId:'sv-flower-pickers-shelter' },
    { id:'south-watch-post',sector:27,name:'South Watch Post',kind:'road-place',keeper:'Watch Guide Eda',role:'Snow-road watcher',description:'A marked winter watch stop connects the public snow road to Sova’s route. The watcher can still receive ordinary reports outside that personal journey.',services:['watch','reception'],left:54,top:38,width:11,height:10,approach:54,art:'watchtower',storyPointId:'ff-south-watch-post',watch:true },
    { id:'lower-road-kitchen',sector:28,name:'Lower-Road Kitchen',kind:'road-place',keeper:'Winter Cook Gen',role:'Winter meal keeper',description:'A public kitchen stop supplies the lower rescue road. Ask for a hot bowl or help the cook prepare the next supply round.',services:['tea','repair'],left:37,top:68,width:11,height:10,approach:88,art:'teahouse',storyPointId:'ff-lower-road-kitchen' },
    { id:'shuttered-boathouse',sector:20,name:'Shuttered Boathouse',kind:'road-place',keeper:'Contact Ren',role:'Trust broker',description:'A discreet road contact tends the boathouse meeting point. Nyx’s recovered ledger is never rewritten by a routine handoff; new errands concern new entrusted messages.',services:['intelligence','reception'],left:62,top:29,width:11,height:10,approach:43,art:'safehouse',storyPointId:'ms-shuttered-boathouse' },
    { id:'old-toll-booth',sector:21,name:'Old Toll Booth',kind:'road-place',keeper:'Toll Clerk Ise',role:'Road witness broker',description:'The old toll meeting place is still used to compare crossing accounts. The clerk accepts only messages whose handling instructions have been respected.',services:['intelligence','register'],left:54,top:38,width:11,height:10,approach:54,art:'safehouse',storyPointId:'ms-old-toll-booth' },
];
architecture.push(...additions.map(roadBuilding));
/** Restoration occupies already-solid masonry, never a road or resource approach.
 * Keeping the silhouette inside the existing mask preserves all travel geometry. */
function restorationSite(building:SectorBuilding):SectorBuilding['restorationSite']{
    if(!building.services.includes('repair'))return;
    const mask=sectorWalkMask(building.sector)!;
    // Intact regional strongholds keep their own roofs and banners. Restore a
    // small public awning at the approach edge; ruins can take a larger shelter.
    const frontage=building.kind==='stronghold';
    const aim=frontage?{left:(building.approach%12+.5)/12*100,top:(Math.floor(building.approach/12)+.5)/12*100}:
        {left:building.left,top:building.top-building.height/2};
    for(const size of frontage?[1]:[2,1]){
        const distance=(tile:number)=>Math.abs((tile%12+size/2)/12*100-aim.left)+Math.abs((Math.floor(tile/12)+size/2)/12*100-aim.top);
        const options=building.footprint.filter(tile=>tile%12+size<=12&&Math.floor(tile/12)+size<=12).map(tile=>({tile,tiles:Array.from({length:size*size},(_,k)=>tile+Math.floor(k/size)*12+k%size)}))
            .filter(site=>site.tiles.every(tile=>building.footprint.includes(tile)&&'#B'.includes(mask[Math.floor(tile/12)][tile%12])))
            .sort((a,b)=>distance(a.tile)-distance(b.tile));
        if(options.length){const site=options[0];return{left:(site.tile%12)/12*100,top:Math.floor(site.tile/12)/12*100,width:size/12*100,height:size/12*100,footprint:site.tiles};}
    }
}
export const SECTOR_BUILDINGS: readonly SectorBuilding[] = architecture.map(building=>({...building,
    art:building.art==='teahouse'&&building.region==='frostfang'?'teahouse-winter':building.art,
    restorationSite:restorationSite(building)}));
const byId = new Map(SECTOR_BUILDINGS.map(building => [building.id, building]));
export const sectorBuilding = (id: unknown): SectorBuilding | undefined => typeof id === 'string' ? byId.get(id) : undefined;
export const buildingsInSector = (sector: number): readonly SectorBuilding[] => SECTOR_BUILDINGS.filter(building => building.sector === sector);
export const buildingHasService = (building: SectorBuilding, service: BuildingService) => building.services.includes(service);
export const buildingSharedKey = (id: string) => `world:building:${id}`;
