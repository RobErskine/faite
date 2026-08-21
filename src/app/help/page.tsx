import { PageShell } from "@/components/marketing/page-shell";
import {
  Prose,
  ProseCallout,
  ProseLink,
  ProseSection,
  ProseTerm,
  ProseText,
  RelatedLinks,
} from "@/components/marketing/prose";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/help");

export default function HelpPage() {
  return (
    <PageShell path="/help">
      <Prose>
        <ProseSection id="the-board" heading="The board, in one picture">
          <ProseText>
            The board splits into two halves. The top half is your calendar
            &mdash; a column per day, plus an Overflow column for things that
            have waited long enough that they need a decision. The bottom
            half is your lists &mdash; where you capture things, including
            <ProseTerm> Backlog</ProseTerm>, a list every account has that can&apos;t
            be deleted.
          </ProseText>
        </ProseSection>

        <ProseSection id="tabs" heading="Tabs vs. lists vs. Backlog">
          <ProseText>
            A <ProseTerm>tab</ProseTerm> groups your list columns &mdash; switching
            tabs swaps which lists you see in the bottom half. Two things stay
            put no matter which tab is open: the calendar half (a to-do
            scheduled for Thursday is on Thursday regardless of what tab
            you&apos;re looking at) and Backlog, which is pinned into every
            tab. Tabs are about filing; the calendar is about time &mdash; keeping
            those separate is what makes switching tabs safe to do without
            losing track of what&apos;s actually due.
          </ProseText>
        </ProseSection>

        <ProseSection id="faite-loop" heading="The Faite Loop">
          <ProseText>
            Miss a to-do and it doesn&apos;t just sit on a date that&apos;s already
            passed &mdash; it rolls forward onto today. Roll it enough times
            (configurable in Settings → Faite Loop, three rolls by default)
            and it falls into <ProseTerm>Overflow</ProseTerm> instead: the idea
            being that something put off that long probably wasn&apos;t as
            important as it seemed. Nothing about this is stored or computed
            by a background job &mdash; it&apos;s recalculated fresh every time
            the board renders, which is why a device that was closed for a
            week catches up correctly the moment you open it again.
          </ProseText>
        </ProseSection>

        <ProseSection id="overdrive" heading="Overdrive: clearing out Overflow">
          <ProseText>
            Once Overflow has enough cards in it, an Overdrive button appears.
            Overdrive is a full-screen, one-card-at-a-time way to burn through
            the pile: for each card, decide won&apos;t do, done, move it back to
            a list, or schedule it forward &mdash; one keystroke or tap each.
            It&apos;s built for a fast, low-friction pass through everything
            that&apos;s accumulated, not for careful triage of each item.
          </ProseText>
        </ProseSection>

        <ProseSection id="day-notes-reminders-locations" heading="Day notes, reminders, and locations">
          <ProseText>
            Every calendar day can carry one freeform note, written in
            markdown &mdash; useful for context that doesn&apos;t belong to any
            single to-do. Reminders fire as browser notifications; you can
            save named presets (like &ldquo;end of day&rdquo;) instead of
            typing a time each time. Locations attach to a to-do as plain
            text, or as a looked-up address if you&apos;re signed in &mdash; see{" "}
            <ProseLink href="/privacy">the privacy policy</ProseLink> for
            exactly how that lookup is handled.
          </ProseText>
        </ProseSection>

        <ProseSection id="offline-and-sync" heading="Offline and sync">
          <ProseText>
            The board works fully offline, with no account at all &mdash; every
            read and write goes to your browser&apos;s local storage first, so
            nothing about using Faite depends on a request succeeding.
            Signing in adds sync on top: your board starts mirroring to
            Faite&apos;s servers, live, across every device you&apos;re signed into.
            Signing out (or never signing in) just means that mirroring
            isn&apos;t happening &mdash; the board underneath keeps working exactly
            the same.
          </ProseText>
        </ProseSection>

        <ProseSection id="shortcuts" heading="Keyboard shortcuts">
          <ProseText>
            Press <ProseTerm>?</ProseTerm> anywhere on the board for the full
            keyboard shortcut reference, including the command palette
            (<ProseTerm>⌘K</ProseTerm>) and @-mention quick-add.
          </ProseText>
        </ProseSection>

        <ProseCallout>
          Didn&apos;t find what you needed? <ProseLink href="/support">Visit Support</ProseLink> for
          how to report a problem.
        </ProseCallout>

        <ProseCallout>
          Still stuck? <ProseLink href="/contact">Get in touch</ProseLink> &mdash; a
          person reads it.
        </ProseCallout>

        <RelatedLinks paths={["/support", "/about"]} />
      </Prose>
    </PageShell>
  );
}
