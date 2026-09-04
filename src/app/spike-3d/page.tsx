import type { Metadata } from "next";
import { RoomStage } from "@/components/spike/room-stage";

/**
 * EI-272 spike route. Throwaway - this never becomes the homepage; it exists
 * to measure one beat of the story before committing to Blender + WebGL.
 *
 * Listed in `PRIVATE_ROUTES` (`src/lib/site.ts`) rather than `SITE_PAGES`:
 * `site.test.ts` asserts the two lists together account for every route under
 * `src/app`, and this one must never reach the sitemap. `pageMetadata()` is
 * deliberately not used - it looks the path up in `SITE_PAGES` and throws.
 *
 * The headline, body and CTA below are a SERVER COMPONENT with no client JS.
 * That is the point: they are the LCP element, they paint before the canvas
 * chunk is even requested, so the 3D weight never lands on the critical path.
 * If that stops being true, the spike has failed.
 */
export const metadata: Metadata = {
  title: "Spike: 3D scene",
  robots: { index: false, follow: false },
};

const BEATS = [
  {
    headline: "You wrote it down. That is most of it.",
    body: "An unfinished task interrupts work that has nothing to do with it. Writing down a plan for it stops the interruptions - not the task, the plan.",
    cite: "Masicampo & Baumeister (2011)",
  },
  {
    headline: "A date and a time. Not just a date.",
    body: "Prompted to write down a date, people did no better than the control group. Prompted to write down a date and a time, they did measurably better.",
    cite: "Milkman et al. (2011)",
  },
  {
    headline: "You were never going to finish on Tuesday.",
    body: "Asked for their best guess, students said 33.9 days. They took 55.5. Fewer than a third finished inside their own most accurate estimate.",
    cite: "Buehler, Griffin & Ross (1994)",
  },
  {
    headline: "The things you keep not doing are the things you keep thinking about.",
    body: "The goals people felt torn about were the ones they acted on least - and thought about most.",
    cite: "Emmons & King (1988)",
  },
  {
    headline: "Letting go helps. Sending it back helps twice as much.",
    body: "Across 31 samples, dropping an unreachable goal helped. Redirecting to a new one helped more than twice as much.",
    cite: "Barlow, Wrosch & McGrath (2020)",
  },
];

export default function Spike3D() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <header className="mb-12 max-w-2xl">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          EI-272 spike
        </p>
        <h1 className="mt-3 font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          One room, one list, three honest endings.
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Control your fate by getting things done.
        </p>
      </header>

      <RoomStage>
        {BEATS.map((beat) => (
          <section
            key={beat.headline}
            className="flex min-h-[80vh] flex-col justify-center py-12"
          >
            <h2 className="font-heading text-3xl font-semibold tracking-tight">
              {beat.headline}
            </h2>
            <p className="mt-4 text-muted-foreground">{beat.body}</p>
            <p className="mt-4 text-xs text-muted-foreground">{beat.cite}</p>
          </section>
        ))}
      </RoomStage>
    </div>
  );
}
