import{i as e,t}from"./react-vendor-CnZExXRc.js";import"./index-BNryNqLe.js";var n=e(),r={"Ashen Leaf Village":{icon:`🔥`,theme:`The Traditional Path`,lore:`Born from the remnants of a world once consumed by fire, Ashen Leaf rose where devastation met renewal.

Long ago, the land was reduced to ash during a great war between rival clans. From that scorched earth, a single forest began to grow—its leaves darkened by soot, yet alive with quiet strength.

The survivors who gathered there believed in preserving the old ways. They rebuilt not just a village, but a philosophy: discipline, balance, and respect for tradition above all else.

Their shinobi are taught that true strength is not taken—it is cultivated. Every jutsu, every movement, is rooted in history. While other villages chase evolution, Ashen Leaf endures.

To walk their path is to carry the weight of legacy… and the honor that comes with it.`},"Stormveil Village":{icon:`⚡`,theme:`The Chaotic Path`,lore:`Stormveil was never meant to exist.

It began as a refuge for outcasts—rogue shinobi, exiles, and warriors who rejected the rigid laws of the great villages. They gathered beneath endless storms, where lightning split the sky and power answered only to those bold enough to seize it.

There were no rulers. No traditions. Only strength.

Over time, Stormveil became something far more dangerous than a village—it became a proving ground. Alliances are temporary, betrayal is common, and power shifts like the storm itself.

Their shinobi embrace unpredictability. They fight without restraint, evolve without limits, and destroy anything that tries to control them.

To join Stormveil is to abandon certainty… and become the storm.`},"Frostfang Village":{icon:`❄️`,theme:`The Loyal Path`,lore:`Far beyond the reach of warm lands lies Frostfang—a village carved into ice and bound by unbreakable unity.

Founded by a single clan that survived the harshest winters imaginable, Frostfang was built on one principle: no one survives alone. The cold does not forgive weakness, and so its people became each other’s strength.

Every shinobi of Frostfang is raised as part of a greater whole. Loyalty is not taught—it is lived. To betray the village is to lose not just honor, but identity.

Their warriors fight with precision and purpose, moving as one, striking as one. Like a pack of wolves in the snow, they overwhelm their enemies through trust and coordination.

To stand with Frostfang is to never stand alone… but to fall means you have failed more than just yourself.`},"Moonshadow Village":{icon:`🌙`,theme:`The Selfish Path`,lore:`Moonshadow exists in silence… and thrives in secrecy.

No one knows exactly when it was founded. Some say it emerged from assassins who abandoned all allegiance. Others believe it was built by those who understood a simple truth: trust is weakness.

In Moonshadow, every shinobi walks their own path. Power is personal. Alliances are fleeting. Even within the village, information is currency—and secrets are worth more than gold.

They are masters of stealth, deception, and precision. They strike from darkness, achieve their goals, and vanish before consequences can follow.

Where other villages build bonds, Moonshadow cultivates ambition.

To choose Moonshadow is to rely on no one… and ensure no one can ever control you.`}},i=t();function a({character:e,onBack:t,onContinue:a}){let o=r[e.village]??{icon:`⚔`,theme:`The Shinobi Path`,lore:`Your shinobi journey begins here.`},[s,c]=(0,n.useState)(``);return(0,n.useEffect)(()=>{c(``);let e=0,t=setInterval(()=>{e++,c(o.lore.slice(0,e)),e>=o.lore.length&&clearInterval(t)},12);return()=>clearInterval(t)},[e.village,o.lore]),(0,i.jsxs)(`div`,{className:`card cinematic-card village-lore-screen`,children:[(0,i.jsxs)(`h1`,{children:[o.icon,` `,e.village]}),(0,i.jsx)(`h3`,{children:(0,i.jsx)(`em`,{children:o.theme})}),(0,i.jsx)(`div`,{className:`village-lore-text`,children:s.split(`
`).map((e,t)=>(0,i.jsx)(`p`,{children:e},t))}),(0,i.jsxs)(`div`,{className:`menu`,children:[(0,i.jsx)(`button`,{onClick:t,children:`Choose Another Village`}),(0,i.jsx)(`button`,{onClick:a,className:`admin-button`,children:`Begin Journey`})]})]})}export{a as VillageLoreScreen};