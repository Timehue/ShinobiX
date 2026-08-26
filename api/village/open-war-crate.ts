// Compatibility alias for clients released before the inventory settlement
// route became canonical. Keeping the URL mounted avoids breaking an older
// browser bundle while ensuring both paths execute the exact same authority,
// stack handling, rewards, and response contract.
export { default } from '../inventory/open-war-crate.js';
