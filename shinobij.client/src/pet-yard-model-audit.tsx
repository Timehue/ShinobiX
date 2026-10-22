// Local QA: exercise the same stage and technique data as the companion inspector.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PetYardModelStage} from './components/PetYardModelStage';
import {petCloseupPresentationModel} from './lib/pet-3d-models';
import {rawPetPool} from './data/pet-pool';
import {STARTER_PETS} from './data/starter-pets';
import {STARTER_EVOLUTIONS} from './data/pet-evolutions';
import {tacticsSpecies,TACTICS_MOVES} from '../../shared/pet-tactics-roster';
const catalog=[...rawPetPool,...STARTER_PETS.map(p=>p.pet),...STARTER_EVOLUTIONS];
const params=new URLSearchParams(location.search),id=params.get('pet')??'standard-0';
const identity=catalog.find(p=>p.id===id);if(!identity)throw Error('Unknown companion identity');
const pet={...identity,level:7},species=tacticsSpecies(id);
const moves=species?[...species.pool.map(id=>TACTICS_MOVES[id]).filter(Boolean),species.signature]:[];
const fail=()=>{throw Error(`Companion renderer failed for ${id}`);};
function App(){
 const [paused,pause]=useState(false),[take,setTake]=useState(0),[turn,rotate]=useState(0),[moveId,setMoveId]=useState(params.get('move')??moves[0]?.id??'');
 const move=moves.find(m=>m.id===moveId);
 if(!petCloseupPresentationModel(pet))return <p data-companion-artwork-fallback={id}>This companion uses its production portrait.</p>;
 return <><div data-companion-audit={id} style={{width:500,height:260}}><PetYardModelStage pet={pet} paused={paused} turn={turn} take={take} move={move} onFail={fail} appearance="original" collarId=""/></div>
  <button onClick={()=>pause(p=>!p)}>{paused?'Resume':'Pause'}</button>
  <button onClick={()=>rotate(t=>t+Math.PI/4)}>Rotate 45</button>
  <select aria-label="Preview technique" value={moveId} onChange={e=>{setMoveId(e.target.value);setTake(0);}}>{moves.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
  <button onClick={()=>{setTake(t=>t+1);pause(false);}}>Play technique</button></>;
}
createRoot(document.getElementById('root')!).render(<App/>);
