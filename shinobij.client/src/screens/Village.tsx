import { type Screen, villagePageImage } from "../App";

export function Village({ characterVillage, setScreen }: { characterVillage: string; setScreen: (screen: Screen) => void }) {
    // `saveMsg` was destructured without a setter and stayed "" forever —
    // the conditional render at line 28 was dead code. Removed.
    const locations = [
        { name: "Battle Arena", icon: "⚔️", screen: "battleArena" as Screen, x: "10%", y: "31%" },
        { name: "Story Hall", icon: "📖", screen: "storyHall" as Screen, x: "29%", y: "33%" },
        { name: "Town Hall", icon: "🏯", screen: "townHall" as Screen, x: "50%", y: "22%" },
        { name: "Bank", icon: "🏦", screen: "bank" as Screen, x: "68%", y: "31%" },
        { name: "Shop", icon: "🛒", screen: "shop" as Screen, x: "18%", y: "79%" },
        { name: "Clan Hall", icon: "⛩️", screen: "clan" as Screen, x: "13%", y: "57%" },
        { name: "Hospital", icon: "🏥", screen: "hospital" as Screen, x: "66%", y: "56%" },
        { name: "Mission Hall", icon: "📜", screen: "missions" as Screen, x: "68%", y: "75%" },
        { name: "Cafeteria", icon: "🍜", screen: "cafeteria" as Screen, x: "82%", y: "45%" },
        { name: "Tavern", icon: "🍺", screen: "tavern" as Screen, x: "82%", y: "63%" },
        { name: "Stat Training", icon: "💪", screen: "training" as Screen, x: "83%", y: "25%" },
        { name: "Jutsu Training", icon: "🔥", screen: "jutsuTraining" as Screen, x: "80%", y: "81%" },
        { name: "World Map", icon: "🗺️", screen: "worldMap" as Screen, x: "45%", y: "68%" },
        { name: "Pet Yard", icon: "🐾", screen: "pets" as Screen, x: "32%", y: "55%" },
        { name: "Card Hall", icon: "🃏", screen: "shinobiTiles" as Screen, x: "52%", y: "55%" },
    ];

    return (
        <div className="stormveil-village-screen">
            <div className="village-save-bar">
                <div className="village-safe-zone">🛡️ SAFE ZONE</div>
            </div>

            <div
                className="stormveil-map"
                style={{
                    backgroundImage: `url(${villagePageImage(characterVillage)})`,
                }}
            >
                {locations.map((location) => (
                    <button
                        key={location.name}
                        className="stormveil-map-button"
                        style={{
                            left: location.x,
                            top: location.y,
                        }}
                        onClick={() => setScreen(location.screen)}
                    >
                        <span>{location.icon}</span>
                        <strong>{location.name}</strong>
                    </button>
                ))}
            </div>
        </div>
    );
}
