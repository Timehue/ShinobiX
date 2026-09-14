import {
    type FirstPactTournamentEncounterId,
    type FirstPactMainBeat,
    type FirstPactEncounterId,
    type FirstPactAftermathId,
    type FirstPactProgress,
    firstPactVow,
    firstPactWritEncounter,
    FIRST_PACT_VOWS,
    FIRST_PACT_DISTRICT_WRITS,
    firstPactWritOpen,
    firstPactBalancingOwed,
    firstPactOpenFindings,
    firstPactStandingSpendable,
    firstPactStandingReserve,
    expectedFirstPactStandingCourtRound,
    FIRST_PACT_STANDING_COURT_LENGTH,
    FIRST_PACT_FINDING_COST,
    expectedFirstPactMainEncounter,
    firstPactTrialRound,
    FIRST_PACT_BALANCING_STANDING,
    expectedFirstPactTournamentEncounter,
    firstPactAvailableAftermath,
} from "../../../../shared/first-pact-contract";
import {
    type FirstPactCompanionView,
    firstPactEpilogueCompanionCopy,
    firstPactCompanionCourtLines,
    firstPactCompanionEverydayLines,
    firstPactAftermathForNpc,
} from "../../lib/first-pact-aftermath";
import {
    type FirstPactNpcDefinition,
    type FirstPactPoint,
    FIRST_PACT_NPCS,
    FIRST_PACT_PLAYER_START,
} from "../../lib/first-pact-world";

type DialogueAction =
    | { kind: "stable-accept" }
    | { kind: "stable-battle"; encounterId: FirstPactTournamentEncounterId }
    | { kind: "main-beat"; beat: FirstPactMainBeat; label: string }
    | { kind: "main-battle"; encounterId: FirstPactEncounterId; label: string };

/** A branch the player picks from inside the dialogue frame. Either it moves
 *  the story on, or it spends Court Standing on a finding. */
type FirstPactDialogueChoice =
    | { label: string; beat: FirstPactMainBeat }
    | { label: string; writId: string }
    | { label: string; aftermathId: FirstPactAftermathId };

type FirstPactDialogue = {
    lines: string[];
    action?: DialogueAction;
    choices?: readonly FirstPactDialogueChoice[];
    /** What the group of choices is for, read out to assistive technology. */
    choicesLabel?: string;
};

function firstPactEpilogue(progress: FirstPactProgress, companions: readonly FirstPactCompanionView[]) {
    const vow = firstPactVow(progress.mainQuest.pactVow);
    const stableRecord = progress.stableQuest.status === "complete"
        ? " Vey's surviving copy names Vale Stable as the winner and keeps every beast's chosen name beside it."
        : "";
    // Standing spent at the Arbiter buys permanence, so permanence is what the
    // epilogue has to show. An entered finding survives the correction that
    // erases the quarter it was written about.
    const entered = progress.findings
        .map((id): string | undefined => firstPactWritEncounter(id)?.title)
        .filter((title): title is string => typeof title === "string");
    const enteredRecord = entered.length
        ? ` The Court entered ${entered.length === 1 ? "one finding" : `${entered.length} findings`} that a later clerk cannot reopen: ${entered.join(", ")}.`
        : "";
    const humanRecord = [
        progress.findings.includes("writ-silencing") ? " Isu leaves one rejected muzzle beside the bell rope." : "",
        progress.findings.includes("writ-audit") ? " Rho keeps the beasts' names in a separate stock column." : "",
        progress.findings.includes("writ-pruning") ? " Kaio leaves one living branch across the old pruning diagram." : "",
        progress.findings.includes("writ-impound") ? " Pell leaves both kennel alleys open." : "",
    ].join("");
    return [
        {
            kicker: "The Last Bell",
            title: "The last correction begins.",
            copy: "The bell rings without Isu's hand. Tam's blue grates pull hard enough to sing. People hurry home while the Court replaces their warnings with harmless explanations.",
        },
        {
            kicker: "What Changed",
            title: "The fall remains. The evidence leaves.",
            copy: `You cannot prevent the Sunken Court from falling. Vey's unedited record survives with the first handlers' pact: the bonded beasts stood as witnesses, never property.${stableRecord}${enteredRecord}${humanRecord}`,
        },
        {
            kicker: "The First Pact",
            title: "Four witnesses cross home with you.",
            copy: `The Celestial light takes your party back to the present. The ruins are unchanged. ${firstPactEpilogueCompanionCopy(companions)} ${vow?.returnCopy ?? "They remember the living city and the choice they made inside it."} On another crossing, the threshold returns you to the same hours before the final correction. Your vow, findings, and Vale's result remain part of that visit.`,
        },
    ] as const;
}

function npcDialogue(npc: FirstPactNpcDefinition, progress: FirstPactProgress): FirstPactDialogue {
    if (npc.id === "keeper-sena") {
        if (progress.mainStep === "make-first-pact") return {
            lines: [
                "The Court calls your companions equipment. I need your answer before Orin opens the sand.",
                "They crossed with you because they chose to. Say what you owe them for that choice.",
                "The first handlers left three promises. Pick the one you can keep when the Court presses it.",
            ],
            choices: FIRST_PACT_VOWS.map((vow) => ({
                label: vow.choice,
                beat: `forge-first-pact-${vow.id}` as FirstPactMainBeat,
            })),
        };
        if (progress.stableQuest.status === "not-started") return {
            lines: [
                "My lead cannot put weight on her foreleg, and the assessor is due at final bell.",
                "If Vale does not make a public entry, every beast here goes to the Court Menagerie.",
                "Lend me your four. Two on the sand, two in reserve. Win under our banner and the assessor has to tear up the transfer in front of the crowd.",
            ],
            action: { kind: "stable-accept" },
        };
        if (progress.stableQuest.status === "complete") return {
            lines: [
                "Hear that? Feed buckets. Hooves. No chains at the door.",
                "Vale stays on the sign, and every beast keeps the name it answers to. Vey copied the result before the assessor left the rail.",
            ],
        };
        return {
            lines: progress.stableQuest.tournamentWins === 0
                ? ["Orin has the entry slate. Get Vale onto it before the assessor reaches this yard."]
                : [`${progress.stableQuest.tournamentWins} bell${progress.stableQuest.tournamentWins === 1 ? "" : "s"} won. The beasts can hear the next crowd. Go finish it.`],
        };
    }
    // A citizen with a writ served on their quarter speaks about that before
    // anything else they might have said. It is the only thing happening to them.
    const writ = FIRST_PACT_DISTRICT_WRITS.find((entry) => entry.giver === npc.id);
    if (writ && firstPactWritOpen(progress, writ.id)) return {
        lines: [writ.summons, writ.lesson],
        action: { kind: "main-battle", encounterId: writ.id, label: `Answer: ${writ.title}` },
    };
    const writReaction = writ ? ({
        "writ-silencing": {
            answered: ["They left the muzzles. I hung one by the rope where every relief warden will see it.", "Vey has the time of the bell and the rookbeasts' warning. The Arbiter still has to enter it as a finding."],
            entered: ["The finding names the bell, the warm nests, and every muzzle. I ring once now. If the birds stay quiet, I do too."],
        },
        "writ-audit": {
            answered: ["The auditor left her sheet. I crossed my haulers out of STOCK and wrote their names large enough to ruin the column.", "Vey has the working copy. The Arbiter can make the separation permanent."],
            entered: ["There. The finding, the separate count, and every chosen name. Let the next auditor try to add them as cargo."],
        },
        "writ-pruning": {
            answered: ["They withdrew. I am still washing their chalk off the old tree; victory does not clean bark.", "Vey marked every branch they meant to cut. The Arbiter can enter that finding."],
            entered: ["I pinned the finding over their four-hundred-year plan. This year's new branch grows across the signature."],
        },
        "writ-impound": {
            answered: ["I can stop holding the gate with my shoulder. I am keeping the bar close.", "Vey copied all four names from the impound order. The Arbiter can enter the finding."],
            entered: ["I say each chosen name before I lift the latch. Both cedar alleys stay open. They pick the way out."],
        },
    } as const)[writ.id] : undefined;
    if (writ && progress.findings.includes(writ.id)) return { lines: [...(writReaction?.entered ?? ["The finding is entered in the Court's own hand."])] };
    if (writ && progress.writs.includes(writ.id)) return { lines: [...(writReaction?.answered ?? ["Vey recorded the detail's withdrawal."])] };

    /*
     * The Court, in the first person.
     *
     * Orin is the clerk who explains the rule. The Arbiter is the office the
     * rule is for, and the two must never say the same thing: where Orin gives
     * the player the threshold as an obstacle, the Arbiter gives them the
     * reason the threshold exists, which is worse to hear.
     *
     * This is also the counter to the campaign's own ruling. The Withheld are
     * the people who refused to cede a defining choice. The Arbiter ceded one,
     * on purpose, and can still defend it. That is what makes the last four
     * rounds an argument rather than a boss.
     */
    if (npc.id === "court-arbiter") {
        const owed = firstPactBalancingOwed(progress);
        const open = firstPactOpenFindings(progress);
        const spendable = firstPactStandingSpendable(progress);
        const reserve = firstPactStandingReserve(progress);
        const lines: string[] = [];
        const standingRound = expectedFirstPactStandingCourtRound(progress);
        if (progress.standingCourt.clears > 0) {
            // Once the Court has lost to this claimant twice, it stops
            // explaining itself and starts keeping count.
            lines.push(
                `${progress.standingCourt.clears} full docket${progress.standingCourt.clears === 1 ? "" : "s"} answered. Your name now appears on every sitting.`,
                "I will sit again. One victory can be dismissed as an exception. Repeated victories force the Court to change its rule.",
            );
        } else if (progress.standingCourt.round > 0) {
            lines.push(
                `${progress.standingCourt.round} of ${FIRST_PACT_STANDING_COURT_LENGTH} sittings stand. Finish all five in this run. Lose one and Orin returns the docket to its first sitting.`,
            );
        } else if (progress.mainStep === "complete" || progress.mainStep === "return-to-threshold") {
            lines.push(
                "You beat the Court in its own square. I entered the result. If this office removes every loss, its rulings prove nothing.",
                "Vey asked for the name I had before this office. I told her the office had no use for it. The truth is that I chose to file it away.",
                "A court ruled by one person is only that person's will. I still believe that. I am less certain what that belief entitled me to erase.",
            );
            if (standingRound) {
                lines.push(
                    "The docket is open again: four sittings, then me. This time I must defend the Court in person.",
                );
            }
        } else if (progress.finalTrial.wins > 0) {
            lines.push(
                `${progress.finalTrial.wins} sitting${progress.finalTrial.wins === 1 ? "" : "s"} answered. The Court records each formation separately; it does not yet accept them as one argument.`,
                "My office judges the formation. It does not ask what each companion wanted before entering it. That rule remains in force until your hearing overturns it.",
            );
        } else if (progress.mainStep === "challenge-court-echo" && owed > 0) {
            lines.push(
                `Orin told you the deficit: ${owed.toLocaleString()} standing. Until you close it, I can refuse your hearing.`,
                "Your claim has witnesses, but it has not met the Court's standing rule. Answer district writs until refusing you would violate that rule.",
            );
        } else if (progress.chapter >= 2) {
            lines.push(
                "Defeating a district detail suspends its order. It does not, by itself, rewrite the finding that authorized it. That distinction keeps one public bout from becoming standing law.",
                "Earn enough public standing and the distinction stops protecting this office. At that point I must put your claim before the Court.",
            );
        } else {
            lines.push(
                "Your seal appears on no threshold plan this office recognizes. I cannot schedule a claimant the record cannot identify.",
                "Bring me a claim with named witnesses and a chain of evidence I can examine. Vey knows which rejected records still carry signatures.",
            );
        }
        if (standingRound) {
            return {
                lines,
                action: {
                    kind: "main-battle",
                    encounterId: standingRound.id,
                    label: standingRound.round === 0
                        ? `Open the docket: ${standingRound.title}`
                        : `Sitting ${standingRound.round + 1} of ${FIRST_PACT_STANDING_COURT_LENGTH}: ${standingRound.title}`,
                },
            };
        }
        if (open.length && spendable >= FIRST_PACT_FINDING_COST) {
            lines.push(
                "Your answered writs are still marked inconclusive. That status lets another clerk reopen them.",
                `Spend ${FIRST_PACT_FINDING_COST.toLocaleString()} standing and I will enter one as a permanent finding. Choose which district gets certainty first.`,
            );
            return {
                lines,
                choicesLabel: "Choose a finding to enter into the permanent record",
                choices: open.map((id) => ({
                    label: `Enter the finding: ${firstPactWritEncounter(id)?.title ?? id}`,
                    writId: id,
                })),
            };
        }
        if (open.length) {
            lines.push(reserve > 0
                ? `Entering a finding costs ${FIRST_PACT_FINDING_COST.toLocaleString()}, and I will not take it out of the ${reserve.toLocaleString()} this docket is still weighing. Answer the Balancing, or earn past the threshold first.`
                : `Entering a finding costs ${FIRST_PACT_FINDING_COST.toLocaleString()}. You are carrying ${spendable.toLocaleString()}. Come back heavier.`);
        } else if (progress.findings.length) {
            lines.push(`${progress.findings.length} finding${progress.findings.length === 1 ? "" : "s"} entered under your name. ${progress.findings.length === 1 ? "It" : "They"} will outlast this room, which I am reliably told is the point of the exercise.`);
        }
        return { lines };
    }

    if (npc.id === "registrar-orin") {
        const mainEncounter = expectedFirstPactMainEncounter(progress);
        const trial = firstPactTrialRound(progress);
        const owed = firstPactBalancingOwed(progress);
        if (!mainEncounter && progress.mainStep === "challenge-court-echo" && owed > 0) return {
            lines: [
                "The Arbiter refused your hearing. You need enough public standing to force it onto the schedule.",
                `You are ${owed.toLocaleString()} short of the required ${FIRST_PACT_BALANCING_STANDING.toLocaleString()}.`,
                "Four Court details are active in the quarters. Defeat enough of them, then report back here.",
            ],
        };
        if (mainEncounter && trial) {
            // The Balancing runs as four sittings. Orin announces the round, and
            // the Court's finding is read out once, before the first of them.
            const opening = trial.round === 1
                ? [
                    "The champion's gate is open. The Court has issued a finding on your companions and scheduled four sittings.",
                    "Its claim is simple: four independent wills create four risks. Give up refusal, and the Court promises to keep all four bodies safe.",
                    firstPactVow(progress.mainQuest.pactVow)?.consequence ?? "It expects one command to be easier to preserve than four living choices.",
                ]
                : trial.round === trial.of
                    ? [
                        "You answered three sittings. The Echo is the fourth and final opponent.",
                        "It fields a defender, sage, assassin, and tracker. Use all four companions; one repeated answer will not cover every role.",
                    ]
                    : [`Sitting ${trial.round} of ${trial.of}. The Court changed its formation. Change yours before the gate opens.`];
            return {
                lines: [...opening, mainEncounter.lesson],
                action: {
                    kind: "main-battle",
                    encounterId: mainEncounter.id,
                    label: `Sitting ${trial.round} of ${trial.of}: ${mainEncounter.title}`,
                },
            };
        }
        if (mainEncounter && mainEncounter.id === "court-menagerie") return {
            lines: [
                "Vey filed the three omens without correction. The Court answered by sending its Menagerie.",
                mainEncounter.lesson,
            ],
            action: { kind: "main-battle", encounterId: mainEncounter.id, label: `Enter: ${mainEncounter.title}` },
        };
        if (progress.stableQuest.status === "not-started") return { lines: ["I cannot enter Vale Stable without Sena's word. Speak to her in the Kennel Ward."] };
        if (progress.stableQuest.status === "complete") return { lines: ["Vale Stable won its public entry. The assessor has withdrawn the transfer order."] };
        const encounter = expectedFirstPactTournamentEncounter(progress);
        return {
            lines: [
                `Next bell: ${encounter?.title ?? "the closed sand"}. ${encounter?.opponent ?? "The Court"} waits across the line.`,
                encounter?.lesson ?? "Bring the four who trust your hand.",
            ],
            action: encounter ? { kind: "stable-battle", encounterId: encounter.id } : undefined,
        };
    }
    if (npc.id === "scribe-vey") {
        if (progress.mainStep === "meet-scribe-vey") return {
            lines: ["Your seal is absent from the current threshold plan. I can verify the mismatch; I cannot verify you. Tell me only what the crossing established."],
            choicesLabel: "Tell Vey only what this crossing established",
            choices: [{ label: "I crossed the Celestial Tower threshold from another age.", beat: "meet-scribe" }],
        };
        if (progress.mainStep === "return-to-vey") return {
            lines: ["Isu heard the bell after the rookbeasts flattened. Tam measured current toward demand that does not exist. Kaio found warm nests under an empty sky.", "Three witnesses, three districts, one morning. Read my copy and confirm I have not made it neater than what you saw."],
            action: { kind: "main-beat", beat: "report-omens", label: "Enter all three omens unaltered" },
        };
        if (progress.mainStep === "recover-withheld-record") return {
            lines: [
                "The Menagerie's obedience slate covered this original. It says the first handlers asked their bonded beasts to witness the pact. It does not say they owned them.",
                "A later margin names them the withheld handlers: people who refused the Court's demand to surrender that choice.",
                "Take the page to Tam. The fiber and seal match the oldest Gateworks plates; she can test that much without trusting my reading.",
            ],
            action: { kind: "main-beat", beat: "recover-record", label: "Take the Withheld record" },
        };
        return { lines: ["My table holds rejected originals. If a clerk asks, you mistook me for a copyist.", progress.mainStep === "investigate-city-omens" ? `You have ${progress.mainQuest.omens.length} of three observations. Bring me names, places, and what happened first.` : "Tell me what your companions notice before the people do. I can compare it with the local reports."] };
    }
    if (npc.id === "bellwarden-isu") return progress.mainStep === "investigate-city-omens" && !progress.mainQuest.omens.includes("bell") ? {
        lines: ["The east bell rang at dawn. My hand was on the rope and the rope never moved.", "The rookbeasts flattened first. Write that order down. The engineers keep leaving it out."],
        action: { kind: "main-beat", beat: "omen-bell", label: "Record the frightened bell" },
    } : { lines: ["The east bell rang without the rope moving. My rookbeasts knew a breath before I did.", "I need the next watch to believe the birds, not the repair notice."] };
    if (npc.id === "engineer-tam") {
        if (progress.mainStep === "investigate-city-omens" && !progress.mainQuest.omens.includes("aqueduct")) return {
            lines: ["The lower intake is pulling above recorded demand. There is no open valve that can account for it.", "The animals stop at the blue grates. Watch the weed: the current bends toward a draw that has not begun."],
            action: { kind: "main-beat", beat: "omen-aqueduct", label: "Record the impossible current" },
        };
        if (progress.mainStep === "meet-engineer-tam") return {
            lines: [
                "Vey reports that you crossed the Celestial Tower threshold from another age with this seal. I cannot test the crossing. I can test the seal.",
                "Its cut and alloy match the oldest intake plate. That plate pairs two witnesses who consent to remember each other.",
                "I can bypass the lower lock once before the pressure trips it. Two assassins hold the inner route. When either strikes, it can withdraw behind the healthiest reserve.",
            ],
            action: { kind: "main-beat", beat: "meet-engineer", label: "Open the old Gateworks route" },
        };
        const mainEncounter = expectedFirstPactMainEncounter(progress);
        if (mainEncounter?.id === "lattice-guardian") return {
            lines: ["The bypass is open and the pressure is climbing. Each assassin can strike, then put a fresh reserve in front of your answer.", mainEncounter.lesson],
            action: { kind: "main-battle", encounterId: mainEncounter.id, label: `Descend: ${mainEncounter.title}` },
        };
        return { lines: ["The lower intake is still above recorded demand with every listed valve shut.", "The animals refuse the blue grates. I have stopped calling that a maintenance problem."] };
    }
    if (npc.id === "market-rho") return progress.stableQuest.status === "complete"
        ? { lines: [
            "Vale feed is paid through the week. Sena tried to return half after the win, so I moved it onto the next stable's account.",
            progress.findings.includes("writ-audit")
                ? "The entered audit keeps the hauling beasts out of the stock count. I still check every shipment."
                : "The public win stopped Vale's transfer. The auditor still comes tomorrow, so I am checking every shipment.",
        ] }
        : { lines: ["I paid Vale's feed through the week. Do not tell Sena until after the final; she will waste time arguing with me.", "Win first. She can repay me when the assessor is gone."] };
    if (npc.id === "kennel-hand") return { lines: ["Leave both alleys open around the cedar. A frightened beast picks a path faster when nobody crowds its hind legs. I will wait where they meet."] };
    if (npc.id === "court-courier") return { lines: ["I delivered three closure orders before noon and carried back four cancellations after the nobles smelled the kennels.", "If you change another order, find me before the afternoon route. I am not walking this district twice."] };
    if (npc.id === "garden-keeper") return progress.mainStep === "investigate-city-omens" && !progress.mainQuest.omens.includes("gardens") ? {
        lines: ["Every bird left the north wall at once. No storm, no hawk. I still had seed in my hand.", "The nests are warm and the eggs remain. Help me record that before someone calls it migration."],
        action: { kind: "main-beat", beat: "omen-gardens", label: "Record the empty sky" },
    } : { lines: ["The birds left warm nests and unbroken eggs. I am keeping the ladders up in case they return."] };
    return { lines: ["I am carrying bets to the Colosseum before the next bell. Mine is on Vale; the odds were insulting."] };
}

function firstPactReactiveDialogue(
    npc: FirstPactNpcDefinition,
    progress: FirstPactProgress,
    companions: readonly FirstPactCompanionView[],
): FirstPactDialogue {
    const base = npcDialogue(npc, progress);
    const courtLines = npc.id === "registrar-orin" && progress.mainStep === "challenge-court-echo"
        ? firstPactCompanionCourtLines(progress, companions)
        : [];
    const everydayLines = firstPactCompanionEverydayLines(npc.id, progress, companions);
    const reactiveLines = [...courtLines, ...everydayLines];
    if (progress.mainStep !== "return-to-threshold" && progress.mainStep !== "complete") {
        return reactiveLines.length ? { ...base, lines: [...base.lines, ...reactiveLines] } : base;
    }
    const aftermath = firstPactAftermathForNpc(npc.id, progress, companions);
    if (!aftermath) return base;
    if (progress.aftermathVisits.includes(aftermath.id)) {
        return { ...base, lines: [...base.lines, ...aftermath.lines] };
    }
    return {
        ...base,
        lines: [...base.lines, "There is time to look at what changed here before you return to the threshold."],
        choicesLabel: "Choose whether to examine this part of the surviving record",
        choices: [...(base.choices ?? []), { label: aftermath.label, aftermathId: aftermath.id }],
    };
}

function mainQuestCopy(progress: FirstPactProgress): { kicker: string; title: string; detail: string; target?: FirstPactPoint } {
    switch (progress.mainStep) {
        case "meet-scribe-vey": return { kicker: "Chapter I · Unedited", title: "A City Still Breathing", detail: "Ask Scribe Vey outside the High Court archive to identify your threshold seal.", target: { x: 42, y: 12 } };
        case "investigate-city-omens": {
            const missing = ["bell", "aqueduct", "gardens"].filter((omen) => !progress.mainQuest.omens.includes(omen as "bell" | "aqueduct" | "gardens"));
            const next = missing[0];
            const targets: Record<string, FirstPactPoint> = { bell: { x: 68, y: 16 }, aqueduct: { x: 68, y: 46 }, gardens: { x: 18, y: 16 } };
            return { kicker: `Chapter I · Omens ${progress.mainQuest.omens.length}/3`, title: "What the Animals Know", detail: `Collect three named observations for Vey. Still needed: ${missing.join(", ")}.`, target: targets[next] };
        }
        case "return-to-vey": return { kicker: "Chapter I · Evidence", title: "Before the Wording Changes", detail: "Bring the three unedited observations to Vey.", target: { x: 42, y: 12 } };
        case "challenge-court-menagerie": return { kicker: "Chapter II · The Court", title: "The Courtesy of Teeth", detail: "Meet Registrar Orin at the southern Colosseum gate and answer the Court Menagerie.", target: { x: 42, y: 34 } };
        case "recover-withheld-record": return { kicker: "Chapter II · Withheld", title: "A Record Without an Owner", detail: "Return to Vey and recover the handlers' original pact.", target: { x: 42, y: 12 } };
        case "meet-engineer-tam": return { kicker: "Chapter III · Intake", title: "What the Gate Keeps", detail: "Carry the original record to Tam at the Gateworks.", target: { x: 68, y: 46 } };
        case "challenge-lattice-guardian": return { kicker: "Chapter III · Intake", title: "The Lattice Wardens", detail: "Descend through the route Tam opened.", target: { x: 68, y: 46 } };
        case "make-first-pact": return { kicker: "Chapter III · Choice", title: "No Companion Is Property", detail: "Bring the recovered pact to Sena and choose what you owe your companions.", target: { x: 24, y: 40 } };
        case "challenge-court-echo": {
            // While the Court can still afford to ignore the claim, the
            // objective is the districts, not the Colosseum. Pointing the guide
            // at Orin here would send the player to be told to go away.
            const owed = firstPactBalancingOwed(progress);
            if (owed > 0) {
                const nextWrit = FIRST_PACT_DISTRICT_WRITS.find((writ) => firstPactWritOpen(progress, writ.id));
                const giver = nextWrit ? FIRST_PACT_NPCS.find((npc) => npc.id === nextWrit.giver) : undefined;
                return {
                    kicker: "Chapter IV · The Docket",
                    title: "Force a Hearing",
                    detail: nextWrit
                        ? `Answer active Court writs in the quarters. You need ${owed.toLocaleString()} more standing to force the hearing.`
                        : `The Court will not sit yet. Earn ${owed.toLocaleString()} more standing, then return to Orin.`,
                    target: giver?.position ?? { x: 42, y: 34 },
                };
            }
            return { kicker: "Chapter IV · The First Pact", title: "Four Wills, One Answer", detail: "Your hearing is open. Report to Orin and complete all four Court sittings.", target: { x: 42, y: 34 } };
        }
        case "return-to-threshold": {
            const available = firstPactAvailableAftermath(progress);
            const remaining = available.filter((id) => !progress.aftermathVisits.includes(id));
            return {
                kicker: "Epilogue · The Last Bell",
                title: "Carry What Survives",
                detail: remaining.length
                    ? `The threshold is open. Cross now, or walk back through ${remaining.length} changed place${remaining.length === 1 ? "" : "s"} before the last correction.`
                    : available.length
                        ? "You have walked back through every surviving change. Return to the Arrival Court before the last correction."
                        : "The threshold is open. Return to the Arrival Court when you are ready to carry the record home.",
                target: FIRST_PACT_PLAYER_START,
            };
        }
        case "complete": {
            // A finished crossing used to point at nothing. The Court sits again.
            const sitting = expectedFirstPactStandingCourtRound(progress);
            if (!sitting) return { kicker: "Chronicle preserved", title: "The First Pact", detail: "The threshold returns you to the same hours before the final correction. Vey retains your vow and findings; Vale retains its recorded result." };
            return {
                kicker: progress.standingCourt.clears > 0
                    ? `The Standing Court · ${progress.standingCourt.clears} answered`
                    : "The Standing Court",
                title: sitting.title,
                detail: progress.standingCourt.round > 0
                    ? `Sitting ${sitting.round + 1} of ${FIRST_PACT_STANDING_COURT_LENGTH}. Lose one and the docket opens again at the top.`
                    : "The Arbiter has reopened the docket in the High Court square. Five sittings, start to finish.",
                target: { x: 52, y: 12 },
            };
        }
        default: return { kicker: "Celestial crossing", title: "The First Pact", detail: "Cross into the Sunken Court's last age." };
    }
}

function questCopy(progress: FirstPactProgress): { kicker: string; title: string; detail: string } {
    if (progress.stableQuest.status === "not-started") return {
        kicker: "Side quest available",
        title: "A Stable's Last Stand",
        detail: "Find Sena Vale in the Kennel Ward.",
    };
    if (progress.stableQuest.status === "complete") return {
        kicker: "Vale Stable secured",
        title: "A Name Worth Keeping",
        detail: "Return to Sena and see what your victory changed.",
    };
    const encounter = expectedFirstPactTournamentEncounter(progress);
    return {
        kicker: `Tournament ${progress.stableQuest.tournamentWins}/3`,
        title: encounter?.title ?? "A Stable's Last Stand",
        detail: "Report to Registrar Orin at the southern Colosseum gate.",
    };
}

export {
    firstPactEpilogue,
    firstPactReactiveDialogue,
    mainQuestCopy,
    questCopy,
};
