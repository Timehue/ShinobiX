/**
 * What an NPC's speech bubble shows: one short line. Greetings can be a whole
 * paragraph (written for the dialogue window, which still shows all of it). A line
 * that fits is kept; a longer one is cut to its first sentence, then to a word.
 */
export const SPEECH_BUBBLE_MAX = 60;

export function speechBubbleLine(text: string, max = SPEECH_BUBBLE_MAX): string {
    const line = text.replace(/\s+/g, " ").trim();
    if (line.length <= max) return line;
    const sentence = /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
    return sentence.length <= max ? sentence : sentence.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}
