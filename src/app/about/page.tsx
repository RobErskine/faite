import { PageShell } from "@/components/marketing/page-shell";
import { Prose, ProseLink, ProseSection, ProseTerm, ProseText, RelatedLinks } from "@/components/marketing/prose";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/about");

export default function AboutPage() {
  return (
    <PageShell path="/about">
      <Prose>
        <ProseSection id="the-name" heading="Faite">
          <ProseText>
            <ProseTerm>Faite</ProseTerm> is &ldquo;done&rdquo; in French. The double
            meaning is the point: you control your fate by getting things
            done.
          </ProseText>
        </ProseSection>

        <ProseSection id="local-first" heading="Local-first, on purpose">
          <ProseText>
            Faite is built local-first: every read and write goes to your own
            device first, so nothing about using it depends on a network
            request succeeding. Signed out, the board works fully offline
            with no account at all &mdash; and nothing you do reaches Faite&apos;s
            servers. Signing in adds sync on top, as an addition rather than
            a requirement.
          </ProseText>
          <ProseText>
            This isn&apos;t just a technical choice. It means the app is fast
            because nothing is ever waiting on a request, it means your data
            survives Faite&apos;s servers having a bad day, and it means the
            honest default is privacy &mdash; your board isn&apos;t Faite&apos;s
            business until you choose to sync it. See{" "}
            <ProseLink href="/privacy">the privacy policy</ProseLink> for the
            specifics.
          </ProseText>
        </ProseSection>

        <ProseSection id="no-tracking" heading="No tracking">
          <ProseText>
            There&apos;s no analytics, no error tracking, no advertising
            technology, and no tracking pixels anywhere in Faite. That&apos;s not
            a policy decided after the fact &mdash; it&apos;s just never been built
            in, because a to-do app doesn&apos;t need to watch what you do to
            work.
          </ProseText>
        </ProseSection>

        <ProseSection id="who-builds-it" heading="Who builds it">
          <ProseText>
            Faite is solo-built. If something&apos;s broken or missing, see{" "}
            <ProseLink href="/help">Help</ProseLink> or{" "}
            <ProseLink href="/support">Support</ProseLink> first &mdash; and if
            that doesn&apos;t answer it, <ProseLink href="/contact">get in touch</ProseLink>.
          </ProseText>
        </ProseSection>

        <RelatedLinks paths={["/help", "/privacy"]} />
      </Prose>
    </PageShell>
  );
}
