/**
 * British → American spellings, as a dictionary the build can check.
 *
 * Faite writes **American English** (`docs/CONTENT.md`). The reason is not
 * that one spelling is better; it is that an unstated convention is not a
 * convention. Before this file existed the product said "color" in one string
 * and "colour" in the next, "Labelled" in an undo toast beside "labeled" in a
 * type, and nothing anywhere recorded which was intended — so every new
 * string re-decided it, and half the time got it wrong.
 *
 * Exported as data rather than buried in the test so `docs/CONTENT.md` can
 * point at one list, and so adding a word is a one-line change with a test
 * that immediately tells you whether it was already being broken.
 */

/**
 * Each entry is a regex source matching the British form (with its inflections)
 * and the American form to use instead.
 *
 * Deliberately NOT exhaustive over all of British English. Every entry here is
 * either a word Faite has actually used or one it plausibly would; a dictionary
 * padded with `aluminium` and `paediatric` is longer to read and no more
 * protective. Add words when they come up.
 */
export const SPELLINGS: { british: string; american: string }[] = [
  // -our → -or
  { british: "colour", american: "color" },
  { british: "colours", american: "colors" },
  { british: "coloured", american: "colored" },
  { british: "colouring", american: "coloring" },
  { british: "behaviour", american: "behavior" },
  { british: "behaviours", american: "behaviors" },
  { british: "favour", american: "favor" },
  { british: "favours", american: "favors" },
  { british: "favourite", american: "favorite" },
  { british: "favourites", american: "favorites" },
  { british: "favourable", american: "favorable" },
  { british: "neighbour", american: "neighbor" },
  { british: "neighbours", american: "neighbors" },
  { british: "neighbouring", american: "neighboring" },
  { british: "honour", american: "honor" },
  { british: "flavour", american: "flavor" },
  { british: "endeavour", american: "endeavor" },

  // -ise → -ize (and -isation → -ization)
  { british: "organise", american: "organize" },
  { british: "organised", american: "organized" },
  { british: "organising", american: "organizing" },
  { british: "organisation", american: "organization" },
  { british: "realise", american: "realize" },
  { british: "realised", american: "realized" },
  { british: "recognise", american: "recognize" },
  { british: "recognised", american: "recognized" },
  { british: "prioritise", american: "prioritize" },
  { british: "prioritised", american: "prioritized" },
  { british: "customise", american: "customize" },
  { british: "customised", american: "customized" },
  { british: "summarise", american: "summarize" },
  { british: "normalise", american: "normalize" },
  { british: "normalised", american: "normalized" },
  { british: "normalisation", american: "normalization" },
  { british: "initialise", american: "initialize" },
  { british: "initialised", american: "initialized" },
  { british: "categorise", american: "categorize" },
  { british: "categorised", american: "categorized" },
  { british: "minimise", american: "minimize" },
  { british: "maximise", american: "maximize" },
  { british: "emphasise", american: "emphasize" },
  { british: "emphasised", american: "emphasized" },
  { british: "apologise", american: "apologize" },
  { british: "serialise", american: "serialize" },
  { british: "synchronise", american: "synchronize" },
  { british: "analyse", american: "analyze" },
  { british: "analysed", american: "analyzed" },

  // -re → -er
  { british: "centre", american: "center" },
  { british: "centres", american: "centers" },
  { british: "centred", american: "centered" },
  { british: "centring", american: "centering" },
  { british: "metre", american: "meter" },
  { british: "metres", american: "meters" },
  { british: "theatre", american: "theater" },

  // -ce → -se. British keeps the noun/verb split; American does not.
  { british: "licence", american: "license" },
  { british: "licences", american: "licenses" },
  { british: "defence", american: "defense" },
  { british: "offence", american: "offense" },
  { british: "practise", american: "practice" },

  // Doubled consonants before a suffix
  { british: "cancelled", american: "canceled" },
  { british: "cancelling", american: "canceling" },
  { british: "labelled", american: "labeled" },
  { british: "labelling", american: "labeling" },
  { british: "modelled", american: "modeled" },
  { british: "modelling", american: "modeling" },
  { british: "travelled", american: "traveled" },
  { british: "travelling", american: "traveling" },
  { british: "fuelled", american: "fueled" },

  // One-offs
  { british: "grey", american: "gray" },
  { british: "greys", american: "grays" },
  { british: "greyed", american: "grayed" },
  { british: "catalogue", american: "catalog" },
  { british: "programme", american: "program" },
  { british: "artefact", american: "artifact" },
  { british: "artefacts", american: "artifacts" },
  { british: "judgement", american: "judgment" },
  { british: "acknowledgement", american: "acknowledgment" },
  { british: "fulfil", american: "fulfill" },
  { british: "enrol", american: "enroll" },
  { british: "storey", american: "story" },
  { british: "sceptical", american: "skeptical" },
  { british: "cheque", american: "check" },
  { british: "aeroplane", american: "airplane" },
  { british: "whilst", american: "while" },
  { british: "amongst", american: "among" },
];

/** One case-insensitive alternation over every British form. */
export const BRITISH_SPELLING_RE = new RegExp(
  `\\b(${SPELLINGS.map((s) => s.british).join("|")})\\b`,
  "gi",
);

/** `"colour"` → `"color"`, preserving the original's capitalization. */
export function americanize(word: string): string | undefined {
  const match = SPELLINGS.find((s) => s.british === word.toLowerCase());
  if (!match) return undefined;
  if (word === word.toUpperCase()) return match.american.toUpperCase();
  if (word[0] === word[0].toUpperCase()) {
    return match.american[0].toUpperCase() + match.american.slice(1);
  }
  return match.american;
}
