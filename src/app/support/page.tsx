import { PageShell } from "@/components/marketing/page-shell";
import {
  Prose,
  ProseCallout,
  ProseItem,
  ProseLink,
  ProseList,
  ProseSection,
  ProseText,
  RelatedLinks,
} from "@/components/marketing/prose";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/support");

export default function SupportPage() {
  return (
    <PageShell path="/support">
      <Prose>
        <ProseCallout>
          Your data lives on your own device first &mdash; don&apos;t clear your
          browser&apos;s site data for myfaite.app while troubleshooting a
          problem. That&apos;s where your board actually lives, and clearing it
          can destroy both the evidence and your data.
        </ProseCallout>

        <ProseSection id="start-here" heading="Start here">
          <ProseText>
            Most questions about how something works are answered in{" "}
            <ProseLink href="/help">Help</ProseLink> &mdash; the Faite Loop, tabs vs.
            lists, Overdrive, day notes, reminders, offline and sync. Worth a
            look before filing a report.
          </ProseText>
        </ProseSection>

        <ProseSection id="report-a-problem" heading="Reporting a problem">
          <ProseText>
            Faite is a solo-built project &mdash; reports are read and answered
            best-effort, not against a guaranteed response time. To help
            things move faster, include:
          </ProseText>
          <ProseList>
            <ProseItem>What you expected to happen, and what happened instead.</ProseItem>
            <ProseItem>Your browser (and whether it&apos;s desktop or mobile).</ProseItem>
            <ProseItem>Whether you were signed in or using the board offline.</ProseItem>
            <ProseItem>
              Anything you did right before it happened &mdash; a specific
              drag, a keyboard shortcut, switching tabs.
            </ProseItem>
          </ProseList>
          <ProseText>
            <ProseLink href="/contact">File a report</ProseLink> with those
            details.
          </ProseText>
        </ProseSection>

        <ProseSection id="account-and-data" heading="Account and data questions">
          <ProseText>
            For anything about what Faite stores, how long it&apos;s kept, or
            deleting your account, see{" "}
            <ProseLink href="/privacy">the privacy policy</ProseLink> &mdash; Settings
            → Account in the app is where account deletion actually happens.
          </ProseText>
        </ProseSection>

        <RelatedLinks paths={["/help", "/privacy"]} />
      </Prose>
    </PageShell>
  );
}
