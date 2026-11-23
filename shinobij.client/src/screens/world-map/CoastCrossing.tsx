type Dock = { sector: number; name: string };
export default function CoastCrossing({ docks, sail, leave }: { docks: Dock[]; sail: (sector: number) => void; leave: () => void }) {
    return <section className="map-instance" aria-label="The Shuttered Boat"><div className="village-full-scene">
        <img src="/coast-map/boats/shard-crossing-v1.webp" alt="" />
        <div className="village-full-overlay">
        <h2>The Shuttered Boat</h2><p>Where will you land?</p>
        <div className="menu">{docks.map(dock => <button key={dock.sector} onClick={() => sail(dock.sector)}>{dock.name}</button>)}
            <button onClick={leave}>Stay ashore</button></div>
        </div></div>
    </section>;
}

