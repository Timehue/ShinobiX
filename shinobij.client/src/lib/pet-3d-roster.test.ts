import test from "node:test";
import assert from "node:assert/strict";
import { APPROVED_ROSTER_MODEL_IDS, ROSTER_MODEL_ASSET_REVISION, approvedRosterCombatModel, inferPet3dProfile, qaRosterBakedRetopoProofModel, qaRosterCombatModel, qaRosterProofModel, qaRosterRetopoProofModel, qaRosterRiggedProofModel } from "./pet-3d-roster";

test("roster profile inference keeps major silhouettes in the right locomotion family", () => {
    assert.equal(inferPet3dProfile("Tempest Hawk"), "avian");
    assert.equal(inferPet3dProfile("Moon Serpent"), "serpentine");
    assert.equal(inferPet3dProfile("Titan Golem"), "heavy");
    assert.equal(inferPet3dProfile("Crimson Fox"), "quadruped");
});

test("only explicitly reviewed roster models leave quarantine", () => {
    assert.deepEqual([...APPROVED_ROSTER_MODEL_IDS], [
        "standard-0", "standard-1", "standard-2", "standard-3", "standard-4",
        "standard-5", "standard-6", "standard-7", "standard-8", "standard-9",
        "standard-10", "standard-11", "standard-12", "standard-13", "standard-14",
        "standard-15", "standard-16", "standard-17", "standard-18", "standard-19",
        "standard-20", "standard-21", "standard-22", "standard-23", "standard-24",
        "standard-25", "standard-26", "standard-27", "standard-28", "standard-29",
        "standard-30", "standard-31", "standard-32", "standard-33", "standard-34",
        "standard-35", "standard-36", "standard-37", "standard-38", "standard-39",
        "standard-40", "standard-41", "standard-42", "standard-43", "standard-44",
        "standard-45", "standard-46", "standard-47", "standard-48", "standard-49",
        "rare-0", "rare-1", "rare-2", "rare-3", "rare-4",
        "rare-5", "rare-6", "rare-7", "rare-8", "rare-9",
        "rare-10", "rare-11", "rare-12", "rare-13", "rare-14",
        "rare-15", "rare-16", "rare-17", "rare-18", "rare-19",
        "rare-20", "rare-21", "rare-22", "rare-23", "rare-24",
        "rare-25", "rare-26", "rare-27", "rare-28", "rare-29",
        "rare-30", "rare-31", "rare-32", "rare-33", "rare-34",
        "rare-35", "rare-36", "rare-37", "rare-38", "rare-39",
        "rare-40", "rare-41", "rare-42", "rare-43", "rare-44",
        "rare-45", "rare-46", "rare-47", "rare-48", "rare-49",
        "legendary-0", "legendary-1", "legendary-2", "legendary-3", "legendary-4",
        "legendary-5", "legendary-6", "legendary-7", "legendary-8", "legendary-9",
        "legendary-10", "legendary-11", "legendary-12", "legendary-13", "legendary-14",
        "legendary-15", "legendary-16", "legendary-17", "legendary-18", "legendary-19",
        "legendary-20", "legendary-21", "legendary-22", "legendary-23", "legendary-24",
        "legendary-25", "legendary-26", "legendary-27", "legendary-28", "legendary-29",
        "mythic-0", "mythic-1", "mythic-2", "mythic-3", "mythic-4",
        "mythic-5", "mythic-6", "mythic-7", "mythic-8", "mythic-9",
        "mythic-10", "mythic-11", "mythic-12", "mythic-13", "mythic-14",
    ]);
    assert.equal(approvedRosterCombatModel({ id: "standard-0", name: "Red Fox" })?.url, `/pet-models/roster/standard-0.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
    assert.equal(approvedRosterCombatModel({ id: "standard-1", name: "Snow Rabbit" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-2", name: "Black Cat" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-3", name: "Forest Hawk" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-4", name: "River Otter" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-5", name: "Stone Turtle" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-6", name: "Desert Lizard" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-7", name: "Ashen Crow" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-8", name: "Blue Frog" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-9", name: "Wild Boar" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-10", name: "Pine Owl" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-11", name: "Sand Snake" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-12", name: "Mist Ferret" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-13", name: "Iron Beetle" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "standard-14", name: "White Crane" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-15", name: "Cinder Rat" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-16", name: "Meadow Deer" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "standard-17", name: "Storm Gull" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-18", name: "Shadow Bat" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-19", name: "Mud Toad" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-20", name: "Leaf Monkey" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-21", name: "Frost Cub" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "standard-22", name: "Temple Gecko" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-23", name: "Rock Badger" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-24", name: "Tiny Wolf" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-25", name: "Flint Jackal" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "standard-26", name: "Ember Mole" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-27", name: "Cinder Moth" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "standard-28", name: "Scorch Skink" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-29", name: "Magma Pup" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "standard-30", name: "Brook Newt" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-31", name: "Pebble Crab" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "standard-32", name: "Tide Minnow" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-33", name: "Reed Heron" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-34", name: "Marsh Eel" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-35", name: "Breeze Finch" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-36", name: "Dust Swift" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-37", name: "Cliff Swallow" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-38", name: "Kite Magpie" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-39", name: "Glide Sparrow" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-40", name: "Spark Shrew" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-41", name: "Bolt Mouse" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-42", name: "Arc Vole" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-43", name: "Storm Shrike" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-44", name: "Zap Quail" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "standard-45", name: "Clay Tortoise" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "standard-46", name: "Moss Hedgehog" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-47", name: "Dune Armadillo" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "standard-48", name: "Gravel Pangolin" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "standard-49", name: "Loam Marmot" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-0", name: "Crimson Fox" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-1", name: "Frost Hare" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-2", name: "Night Panther" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-3", name: "Sky Falcon" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-4", name: "Tide Otter" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-5", name: "Ironback Turtle" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-6", name: "Dune Viper" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-7", name: "Ashwing Raven" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-8", name: "Azure Toad" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-9", name: "Bristle Boar" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-10", name: "Silver Owl" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-11", name: "Glass Serpent" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-12", name: "Mist Lynx" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-13", name: "Steel Beetle" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "rare-14", name: "Pearl Crane" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-15", name: "Cinder Weasel" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-16", name: "Thorn Stag" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-17", name: "Stormfin Gull" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-18", name: "Duskwings Bat" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-19", name: "Mossback Toad" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-20", name: "Bamboo Ape" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-21", name: "Frostbite Cub" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-22", name: "Shrine Salamander" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-23", name: "Granite Badger" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-24", name: "Young Direwolf" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-25", name: "Magma Hyena" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-26", name: "Ember Ocelot" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-27", name: "Pyre Kestrel" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-28", name: "Scoria Mongoose" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-29", name: "Blaze Caracal" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-30", name: "Tidal Mink" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-31", name: "Frost Seal" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-32", name: "Coral Serval" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-33", name: "Brine Cormorant" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-34", name: "Glacier Marten" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-35", name: "Cyclone Harrier" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-36", name: "Zephyr Osprey" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-37", name: "Gust Tern" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-38", name: "Squall Plover" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-39", name: "Drift Albatross" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-40", name: "Volt Polecat" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-41", name: "Surge Stoat" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-42", name: "Thunder Jerboa" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-43", name: "Static Meerkat" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-44", name: "Arc Buzzard" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "rare-45", name: "Granite Wombat" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-46", name: "Stoneback Tapir" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-47", name: "Quartz Aardvark" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "rare-48", name: "Terra Porcupine" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "rare-49", name: "Bramble Capybara" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-0", name: "Glacier Wolf" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-1", name: "Tempest Hawk" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "legendary-2", name: "Umbra Fox" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-3", name: "Spirit Deer" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-4", name: "Ironfang Tiger" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-5", name: "Azure Kirin" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-6", name: "Ember Phoenix" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "legendary-7", name: "Moon Serpent" })?.profile, "serpentine");
    assert.equal(approvedRosterCombatModel({ id: "legendary-8", name: "Storm Lion" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-9", name: "Crystal Bear" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "legendary-10", name: "Void Raven" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "legendary-11", name: "Thunder Drake" })?.profile, "serpentine");
    assert.equal(approvedRosterCombatModel({ id: "legendary-12", name: "Frost Lynx" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-13", name: "Armored Polar Bear" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "legendary-14", name: "Ancient Crane" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "legendary-15", name: "Inferno Chimera" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-16", name: "Ash Garuda" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "legendary-17", name: "Magma Behemoth" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "legendary-18", name: "Tidelord Leviathan" })?.profile, "serpentine");
    assert.equal(approvedRosterCombatModel({ id: "legendary-19", name: "Frost Wyrm" })?.profile, "serpentine");
    assert.equal(approvedRosterCombatModel({ id: "legendary-20", name: "Abyss Kraken" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-21", name: "Storm Roc" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "legendary-22", name: "Tempest Pegasus" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-23", name: "Cyclone Sphinx" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-24", name: "Thunder Raiju" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-25", name: "Storm Wyvern" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-26", name: "Galvanic Manticore" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-27", name: "Titan Golem" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "legendary-28", name: "Granite Gargoyle" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "legendary-29", name: "Verdant Treant" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "mythic-0", name: "Eclipse Kitsune" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "mythic-1", name: "Worldstorm Dragon" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "mythic-2", name: "Ancient Frost Titan" })?.profile, "heavy");
    assert.equal(approvedRosterCombatModel({ id: "mythic-3", name: "Solar Stag" })?.profile, "quadruped");
    assert.equal(approvedRosterCombatModel({ id: "mythic-4", name: "Abyssal Oni Hound" })?.profile, "quadruped");
    const hollowHound = approvedRosterCombatModel({ id: "hollow-hound-encounter-1234567890123", name: "Hollow Hound Alpha" });
    assert.equal(hollowHound?.visualId, "mythic-4", "the separate Hollow identity still resolves the approved Oni rig");
    assert.match(hollowHound?.url ?? "", /\/mythic-4\.glb\?/);
    assert.equal(approvedRosterCombatModel({ id: "mythic-5", name: "Vermillion Suzaku" })?.profile, "avian");
    assert.equal(approvedRosterCombatModel({ id: "mythic-6", name: "Azure Ryujin" })?.profile, "serpentine");
    assert.equal(approvedRosterCombatModel({ id: "mythic-7", name: "Turtle Duck" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "mythic-8", name: "Stormgod Raijin" })?.profile, "biped");
    assert.equal(approvedRosterCombatModel({ id: "mythic-9", name: "Worldroot Colossus" })?.profile, "heavy");
    const breedingMythics = [
        ["mythic-10", "Ash Crown Phoenix", "avian"],
        ["mythic-11", "Moonwell Leviathan", "serpentine"],
        ["mythic-12", "Skyglass Kirin", "quadruped"],
        ["mythic-13", "Thunderbloom Kirin", "quadruped"],
        ["mythic-14", "Gravepeak Behemoth", "heavy"],
    ] as const;
    for (const [id, name, profile] of breedingMythics) {
        const model = approvedRosterCombatModel({ id, name });
        assert.equal(model?.visualId, id);
        assert.equal(model?.profile, profile);
        assert.match(model?.url ?? "", new RegExp(`/roster/${id}\\.glb\\?`));
    }
    const qa = qaRosterCombatModel({ id: "standard-0", name: "Red Fox" });
    assert.equal(qa.url, `/pet-models/roster/standard-0.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
    assert.equal(qa.profile, "quadruped");
    const proof = qaRosterProofModel({ id: "standard-0", name: "Red Fox" });
    assert.equal(proof.url, "/pet-models/proofs/standard-0-multiview.glb");
    assert.equal(proof.visualId, "standard-0-multiview-proof");
    const rigged = qaRosterRiggedProofModel({ id: "standard-0", name: "Red Fox" });
    assert.equal(rigged.url, "/pet-models/proofs/standard-0-rigged.glb");
    assert.equal(rigged.visualId, "standard-0-rigged-proof");
    const retopo = qaRosterRetopoProofModel({ id: "standard-0", name: "Red Fox" });
    assert.equal(retopo.url, "/pet-models/proofs/standard-0-retopo.glb");
    assert.equal(retopo.visualId, "standard-0-retopo-proof");
    const baked = qaRosterBakedRetopoProofModel({ id: "standard-0", name: "Red Fox" });
    assert.equal(baked.url, "/pet-models/proofs/standard-0-retopo-baked.glb");
    assert.equal(baked.visualId, "standard-0-retopo-baked-proof");
});
