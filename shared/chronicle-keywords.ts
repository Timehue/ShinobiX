/*
 * Chronicle Showdown keyword rules text.
 *
 * Kept apart from chronicle-duel.ts so a card face can print a keyword without
 * importing the whole rules engine into its bundle chunk.
 */

/** Rules text for the Warded keyword: the card inspector, the screen-reader
 *  label and the Card Hall rules carry it in full. */
export const WARDED_RULE_TEXT =
  "Warded: Snares cannot destroy this card or return it to the hand during the turn it is Summoned.";

/** The keyword alone, for the card face. Its text box has a fixed height, and
 *  the full rule pushed an Effect Monster's own text out of view. */
export const WARDED_KEYWORD = "Warded.";
