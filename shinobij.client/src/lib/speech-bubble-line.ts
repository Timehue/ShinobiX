/**
 * What an NPC's speech bubble shows: one short line. Greetings and barks can be a
 * whole paragraph (they are written for the dialogue window, which still shows all
 * of it), and a paragraph in a bubble above a head is a white wall. A line that
 * fits is kept as it is; a longer one is cut to its first sentence, and to a word
 * boundary if that is still long.
 */
export const SPEECH_BUBBLE_MAX = 60;

export function speechBubbleLine(text: string, max = SPEECH_BUBBLE_MAX): string {
    const line = text.replace(/\s+/g, " ").trim();
    if (line.length <= max) return line;
    const sentence = /^.*?[.!?…](?=\s|$)/.exec(line)?.[0] ?? line;
    if (sentence.length <= max) return sentence;
    const cut = sentence.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return (space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, "") + "…";
}
