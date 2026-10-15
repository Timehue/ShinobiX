const fs = require('node:fs');
const path = require('node:path');
const file = path.resolve(__dirname, '../shinobij.client/art-source/chronicle-refresh/manifest.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const briefs = {
  'tc-61': 'An unmistakable small fire ant with six legs, antennae and segmented obsidian/ember-red chitin, glowing mandibles biting a charred twig, on mossy ground at a Japanese-inspired village edge. Intimate grounded scene, clear insect anatomy, never a human ninja.',
  'tc-131': 'One immense serpentine drake coils over a shattered mountain shrine in a thunderstorm. Distinct reptilian dragon head at the upper central focal point, dark indigo and silver armored scales, luminous cyan eyes, lightning following the coil, small distant mountain fragments establish scale. This is the dragon itself, not a humanoid dragon-armored ninja. Keep the legendary scene readable and the energy selective.',
  'story-story-ai-frostfang-village-4': 'Preserve the reference white wolf puppy, bright blue eyes, indigo scarf and small snowflake chest armor. Paint a fresh portrait scene of the puppy standing alert on snow-covered stone steps in a lantern-lit Frostfang village at twilight. Gentle cool moonlight balanced with warm lanterns, simple background depth, beautiful fur detail, lovable but anatomically convincing. Modest common-rarity effects, no excessive ice explosion.',
  'story-story-ai-frostfang-village-25': 'Preserve the masked ice guardian identity: angular indigo crystalline armor, broad woven conical hat edged with icicles, dark blue face covering and scarf. New three-quarter pose guarding a snowbound shrine bridge, one gloved hand forming a seal with a restrained curved ice ward. Visibly hand-painted anime fantasy rather than glossy photographic rendering. Guardian face in the upper central focal region; hat does not hide it. Clear silhouette, two natural arms, expressive eyes.',
  'pet-witness-wind': 'Preserve the reference golden hawk companion identity: amber-gold feathers, emerald-green eyes, steel-gray forehead band and deep teal scarf. Paint an original richly detailed scene of this bird banking above an old shinobi village roof with a graceful mint-green wind ribbon following its wings. Convincing feather layers and bird anatomy, determined expression, same premium painted fantasy style as the other cards. Not a flat cartoon cutout, no human body.',
  'story-wandering-sage': 'Preserve the reference elderly wandering sage: deeply lined face, long white beard, hooded black cloak, broad weathered straw hat, subtly violet glowing eyes and crooked wooden staff with blank paper talismans. Paint a fresh three-quarter portrait on a moonlit mountain shrine path, warm gold lantern light grazing weathered cloth, restrained violet mist at the staff. Recognizable mysterious face centered in the upper focal area, beautifully painted skin and fabric, strong legendary presence without clutter. No lettering on talismans.',
  'chronicle-forbidden-archive': 'An ancient sealed underground archive beneath a shinobi temple. A lone gloved hand lifts a worn lacquered scroll case from a stone lectern as restrained violet-gold chakra escapes its unbroken binding. Monumental shelves recede in shadow, suspended parchment strips and dust catch warm lantern light. The focal artifact occupies the central upper half, cinematic hand-painted fantasy materials, readable silhouette, a specific moment of dangerous discovery. No writing, no card frame, no stock library photograph.',
  'chronicle-gale-reversal': 'A wind shinobi in charcoal and deep teal cloth braces on a shrine bridge, reversing an incoming pressure wave with one clear open palm; a crescent of translucent jade wind bends back toward the distant attacker. Main figure in a readable diagonal three-quarter pose, cloth follows the force, two anatomically natural hands, atmospheric trees and temple roof behind. Premium hand-painted anime fantasy scene, controlled wind effects, no tangled storm covering the subject.'
};
for (const row of data.cards) if (briefs[row.id]) {
  if (row.status === 'packaged') continue;
  row.prompt = row.prompt.split('\nSpecific art brief:')[0] + '\nSpecific art brief: ' + briefs[row.id];
  if (['story-story-ai-frostfang-village-4','story-story-ai-frostfang-village-25','pet-witness-wind','story-wandering-sage'].includes(row.id)) {
    row.identityReference = row.originalPath;
    row.prompt += '\nInput image: identity reference only. Preserve this character’s distinguishing features while painting a new scene in the shared style, with the focal face between 25% and 45% from the top.';
  }
}
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log('Eight pilot briefs saved.');
