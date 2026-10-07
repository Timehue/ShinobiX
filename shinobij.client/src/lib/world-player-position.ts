import { createContext, type RefObject } from 'react';
/** Render/sensing coordinates; authoritative zone membership still belongs to the server. */
export const WorldPlayerPosition = createContext<RefObject<{ sector: number; col: number; row: number } | null> | null>(null);
