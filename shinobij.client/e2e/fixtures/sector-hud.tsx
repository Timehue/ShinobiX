/* Development-only component boundary fixture; never imported by the game entry. */
import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SectorHud } from '../../src/components/SectorHud';
import { WorldSectorCanvas } from '../../src/components/WorldSectorCanvas';
import { projectSectorPlayers } from '../../src/lib/sector-player-roster';
import { useSectorPlayerAction } from '../../src/lib/use-sector-player-action';
import type { PlayerRecord } from '../../src/types/character';
import type { WorldSectorCommandPanelProps } from '../../src/components/WorldSectorCommandPanel.types';
import { sectorExits as roadExitsForSector } from '../../../shared/sector-links';
import { sectorBackgroundImage } from '../../src/screens/world-map/sector-art';
import '../../src/index.css';
import '../../src/styles/veiled-steel.css';
import '../../src/styles/layout/adaptive-stages.css';

type Settings = { sector: number; present: boolean; depleted: boolean; suspended: boolean; contest: boolean; blocked: boolean; broken: boolean; pending: boolean; hunt: boolean; vista: boolean; fighting: boolean; awake: boolean };
const events: string[] = [];
let finish: () => void = () => {};
declare global { interface Window { sectorFixture: {
    configure: (settings: Partial<Settings>) => void; events: string[]; finish: () => void;
} } }

export function Fixture() {
    const [settings, setSettings] = useState<Settings>({sector:22,present:true,depleted:false,suspended:false,contest:true,blocked:false,broken:false,pending:false,hunt:true,vista:false,fighting:false,awake:false});
    useLayoutEffect(() => { window.sectorFixture = {configure: next=>setSettings(prev=>({...prev,...next})), events, finish:()=>finish()}; });
    const [endsAt] = useState(() => Date.now()+3_600_000);
    const contest = settings.contest ? {id:'fixture-war',sector:settings.sector,winCondition:'card' as const,attackerVillage:'Stormveil Village',defenderVillage:'Ashen Leaf Village',endsAt,garrisonReady:true}:null;
    const target = (name: string, sleeping = false) => ({name,level:46,currentSector:settings.sector,inBattle:settings.fighting&&!sleeping,village:'Ashen Leaf Village',specialty:'Ninjutsu',character:{avatarImage:settings.broken?'/fixture-broken.webp':'/portraits/corvo-latch.webp'},__sleeping:sleeping&&!settings.awake} as PlayerRecord & {__sleeping:boolean});
    const players = projectSectorPlayers([target('A Very Long Shinobi Name From the Northern Watch'),target('SleepingNinja',true)],{
        sector:settings.sector,village:'Stormveil Village',images:{},contest,blockedReason:settings.blocked?'Progress-changing web actions are temporarily paused.':undefined,
    });
    const action = async (p:PlayerRecord, verb:string) => {
        events.push(`${verb}:${p.name}`);
        if(settings.pending) await new Promise<void>(resolve=>{finish=resolve;});
        events.push(`reconciled:${p.name}`);
    };
    const playerAction = useSectorPlayerAction({sector:settings.sector,present:settings.present,rows:()=>players,
        attack:p=>action(p,'attack'),strike:p=>action(p,'strike'),spectate:async(p,isCurrent)=>{await action(p,'spectate');events.push(isCurrent()?'spectator-opened':'spectator-cancelled');}});
    const note = (name:string) => () => {events.push(name);};
    const props:WorldSectorCommandPanelProps = {
        sector:settings.sector,present:settings.present,biome:'shadow',weather:'clear',
        territory:{isLive:true,isOwned:true,ownerLabel:'Northern Watch (Stormveil)',rebuildMinsLeft:0,controlScore:450,hp:900,breached:false,breachMinsLeft:0,rewardsSuspended:false,guards:['River Guard'],enemyControlled:true},
        gathering:{hydrated:true,exploresUsed:settings.depleted?1500:25,exploresCap:1500,chestsUsed:3,chestsCap:225},
        contract:{contract:{sector:settings.sector,day:'2026-09-19',target:8,ryo:288,nightOnly:false},progress:8,claimed:false,claimable:true,acceptingWork:true},contractBusy:false,
        villageWarAdmissionOpen:!settings.blocked,traces:null,sectorContest:contest,sectorGarrisonReady:true,
        players:settings.present?players:[],hunt:settings.hunt?{targetName:'Trail Beast',progress:2,requiredTracks:3,ready:false}:null,
        onRaidEnemyVillage:note('raid-village'),onRaidControlledSector:note('raid-sector'),onOpenSigns:note('signs'),onOpenShrine:note('shrine'),
        onOpenSectorContest:note('contest'),onFightSectorGarrison:note('garrison'),onClaimContract:note('claim'),
        onExplore:note('explore'),onFindRicherGround:note('richer'),onHunt:note('hunt'),
    };
    return <div className="map-instance" style={{maxWidth:900,margin:'12px auto'}}><div className="instance-frame sector-instance-frame">
        <WorldSectorCanvas sector={settings.sector} biome="shadow" weather="clear" ambienceBiome="shadow"
            playerTile={78} playerName="FixtureViewer" playerAvatarImage="" suspended={settings.suspended}
            isCurrent={settings.present} enterDirection={null} regionSplash={null} onRegionSplashDone={()=>{}}
            mapImage={settings.vista?undefined:`/sector-map/s${settings.sector}.webp`} sceneImage={sectorBackgroundImage(settings.sector)} roadExits={roadExitsForSector(settings.sector)}
            showLivePeers={false} players={[]} sharedImages={{}} sleeperPeers={[]}
            onSelectTile={note('tile')} onCrossExit={note('exit')} overlayLayer={null} encounterLayer={null}
            hudLayer={<SectorHud key={settings.sector} {...props} rosterState="current" playerAction={playerAction} onPlayerAction={playerAction.run}/>} />
    </div></div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
