import { AdminCircuit } from "../features/dojo-circuit/AdminCircuit";
import type { Character } from "../types/character";

// The Admin Panel's World Events tab (full admins only; AdminPanel.tsx gates
// it). Extracted from AdminPanel.tsx to keep that file inside its line budget
// (AdminPanel.size.test.ts); the markup is unchanged.
export function AdminWorldEventsPanel({ credential, character }: { credential: string; character: Character }) {
    return (
        <div className="admin-subpanel">
            <div className="admin-panel-heading">
                <h3>World Events</h3>
                <p>These controls govern global events rather than village-specific territory systems.</p>
            </div>
            <AdminCircuit credential={credential} character={character} />
        </div>
    );
}
