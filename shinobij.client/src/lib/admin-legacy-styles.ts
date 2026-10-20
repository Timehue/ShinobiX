import type {CSSProperties} from 'react';
/** Shared immutable presentation values; original styles and action logic stay identical. */
export const legacyNoMargin:Readonly<CSSProperties>={ margin: 0 };
export const legacyPanelPadding:Readonly<CSSProperties>={ padding: 12 };
export const legacyTitleMargin:Readonly<CSSProperties>={ margin: '0 0 8px' };
export const legacyLeftGap:Readonly<CSSProperties>={ marginLeft: 8 };
export const legacyWideField:Readonly<CSSProperties>={ width: '100%', marginBottom: 6 };
export const legacyMutedNote:Readonly<CSSProperties>={ margin: 0, fontSize: '.78rem', color: '#9aa3b2' };
export const legacyCompactNote:Readonly<CSSProperties>={ margin: '2px 0', fontSize: '.78rem' };
