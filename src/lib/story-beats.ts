/**
 * The homepage story, one row per beat.
 *
 * Three separate things read this table and they must never disagree: the
 * camera frames the object a beat is about (EI-276), the copy states what the
 * research found (EI-277), and the sub-task ticks off in the product panel
 * beside it (EI-278). A beat, an object, a claim and a sub-task are one unit,
 * so they live on one row — the alternative is three parallel arrays kept in
 * step by hand, and the failure mode there is silent: the room shows the
 * bookcase while the copy talks about paint.
 *
 * Copy is governed by `docs/RESEARCH.md`: the §2 evidence tables are the only
 * source, quotes are verbatim, and §4's "claims we do not make" list is
 * checked before any number is printed. EI-277 adds the plain-language
 * `claim` line that goes in front of each citation.
 */
export interface StoryBeat {
  headline: string;
  body: string;
  /** The study, named. EI-277 puts a plain-language finding in front of it. */
  cite: string;
  /**
   * This beat's line in the "Plan living room move" card.
   *
   * In order: the reader is `n` beats in, so `n` sub-tasks are done. That
   * identity is what lets EI-278 drive the ticks from scroll progress alone.
   */
  subtask: string;
}

export const STORY_BEATS: StoryBeat[] = [
  {
    headline: "You wrote it down. That is most of it.",
    body: "An unfinished task interrupts work that has nothing to do with it. Writing down a plan for it stops the interruptions - not the task, the plan.",
    cite: "Masicampo & Baumeister (2011)",
    subtask: "Get everything out of my head and onto the list",
  },
  {
    headline: "A date and a time. Not just a date.",
    body: "Prompted to write down a date, people did no better than the control group. Prompted to write down a date and a time, they did measurably better.",
    cite: "Milkman et al. (2011)",
    subtask: "Pick a paint colour and book the painter",
  },
  {
    headline: "You were never going to finish on Tuesday.",
    body: "Asked for their best guess, students said 33.9 days. They took 55.5. Fewer than a third finished inside their own most accurate estimate.",
    cite: "Buehler, Griffin & Ross (1994)",
    subtask: "Measure the room before ordering the couch",
  },
  {
    headline: "The things you keep not doing are the things you keep thinking about.",
    body: "The goals people felt torn about were the ones they acted on least - and thought about most.",
    cite: "Emmons & King (1988)",
    subtask: "Decide about the old bookcase",
  },
  {
    headline: "Letting go helps. Sending it back helps twice as much.",
    body: "Across 31 samples, dropping an unreachable goal helped. Redirecting to a new one helped more than twice as much.",
    cite: "Barlow, Wrosch & McGrath (2020)",
    subtask: "Sell or donate what is not coming with us",
  },
];
