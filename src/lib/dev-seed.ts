import { addDays, todayIn } from "./scheduling";
import { getDb } from "./store/db";
import { createTodo } from "./store/repositories";

/**
 * Local-dev-only Overflow seeding — settings → Developer's "Seed Overflow"
 * button (`developer-section.tsx`). Populates a realistic pile so Overdrive
 * (EI-97) can be iterated on without missing to-dos by hand ten times a day.
 *
 * Built on `createTodo` — no bespoke write path, so a seeded row is
 * indistinguishable from a real one and syncs like anything else.
 */

const TITLE_POOL = [
  "Renew passport",
  "Schedule dentist appointment",
  "Return library books",
  "Cancel unused subscription",
  "Follow up with accountant",
  "Fix squeaky door hinge",
  "Write thank-you note",
  "Update resume",
  "Back up old photos",
  "Research flight options",
  "Call plumber about the leak",
  "Organize the garage",
  "Draft blog post outline",
  "Review insurance policy",
  "Plan the weekend trip",
  "Replace air filter",
  "Reply to Sarah's email",
  "Sort through mail pile",
];

const DESCRIPTION_POOL = [
  null,
  null,
  null,
  "Check online first — avoid the line if possible.",
  "Ask about the discount code from last time.",
  "Needs the model number off the box.",
];

/**
 * Create `count` open to-dos backdated far enough that they land in Overflow
 * under the CURRENT `overflowAfterDays` setting, spread across whichever
 * non-backlog lists already exist so the pile isn't ten identical cards from
 * one list.
 *
 * `-(overflowAfterDays + 2 + i)` rather than a fixed offset: staggering by
 * `i` gives every card a different "In Overflow N days" badge, which is the
 * whole point of testing against a realistic pile rather than a uniform one.
 * `+2` clears the threshold with room to spare regardless of `workdaysOnly`
 * skipping a weekend in between.
 */
export async function seedOverflow(
  count: number,
  opts: { overflowAfterDays: number; timezone: string },
): Promise<number> {
  const db = getDb();
  const today = todayIn(opts.timezone);

  const [lists, labels] = await Promise.all([
    db.lists.toArray(),
    db.labels.toArray(),
  ]);
  const candidateLists = lists.filter((l) => !l.isBacklog && !l.archivedAt && !l.deletedAt);
  const aliveLabels = labels.filter((l) => !l.deletedAt);

  for (let i = 0; i < count; i++) {
    const title = TITLE_POOL[i % TITLE_POOL.length];
    const description = DESCRIPTION_POOL[i % DESCRIPTION_POOL.length];
    const listId = candidateLists.length ? candidateLists[i % candidateLists.length].id : null;
    // Roughly one in four gets a label and a deadline — enough variety to
    // exercise the card without every seeded row looking alike.
    const labelIds =
      aliveLabels.length && i % 4 === 0 ? [aliveLabels[i % aliveLabels.length].id] : [];
    const deadline = i % 4 === 1 ? addDays(today, 2 + (i % 3)) : null;

    await createTodo({
      title: `${title}${count > TITLE_POOL.length ? ` (${i + 1})` : ""}`,
      description,
      listId,
      labelIds,
      deadline,
      scheduledDate: addDays(today, -(opts.overflowAfterDays + 2 + i)),
    });
  }

  return count;
}
