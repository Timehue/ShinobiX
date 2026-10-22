import { calibratePetVisibleGround } from './visible-ground-calibration-v6.mjs';
const result = await calibratePetVisibleGround({
  id: 'rare-6',
  sourcePath: '.tmp/sol-viper-four-leg-rig-v1/delivery/public/pet-models/roster/rare-6.glb',
  battlePath: '.tmp/sol-viper-four-leg-rig-v1/delivery/public/pet-models/warfront-lod/roster/rare-6.glb',
  sourceOutput: '.tmp/sol-viper-four-leg-rig-v1/grounded-v6/source.glb',
  battleOutput: '.tmp/sol-viper-four-leg-rig-v1/grounded-v6/battle.glb',
  inputPins: {
    source: '08f51ca825d1ce6fb9b7dd92ba0a91f8cf2b7115b7e71622d3914fd73aede6d8',
    battle: '8fcdaefb5fb37d7d93f8deaa4665492091a6a57bb050b9ad2a9c33cfd12222a5',
  },
});
console.log(JSON.stringify(result));
