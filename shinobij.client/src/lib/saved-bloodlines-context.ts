import { createContext } from "react";
import type { SavedBloodline } from "../types/combat";

// The player's stored bloodlines, for fight screens reached through wrappers
// that never took them as a prop (war panels, the World Map vault, world bosses).
export const SavedBloodlinesContext = createContext<SavedBloodline[]>([]);
