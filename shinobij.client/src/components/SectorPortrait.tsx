import { useState } from 'react';

/** Key this leaf by source to retry changed artwork without remounting a marker. */
export function SectorPortrait({ src, name, hideInitialsOnLoad=false }: { src?: string; name: string; hideInitialsOnLoad?:boolean }) {
    const [failed, setFailed] = useState(false);
    const [loaded,setLoaded]=useState(false);
    return <>
        {(!hideInitialsOnLoad||!loaded||failed)&&<span className="sector-avatar-initials">{name.slice(0, 2).toUpperCase()}</span>}
        {src && !failed && <img src={src} alt="" style={{position:'absolute',inset:0}}
            onLoad={hideInitialsOnLoad?()=>setLoaded(true):undefined}
            onError={() => setFailed(true)} />}
    </>;
}
