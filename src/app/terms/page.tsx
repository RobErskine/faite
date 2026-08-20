import { LegalPlaceholderNotice } from "@/components/marketing/legal-placeholder-notice";
import { PageShell } from "@/components/marketing/page-shell";
import {
  Prose,
  ProseItem,
  ProseLink,
  ProseList,
  ProseSection,
  ProseTerm,
  ProseText,
  RelatedLinks,
} from "@/components/marketing/prose";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/terms");

export default function TermsPage() {
  return (
    <PageShell path="/terms">
      <Prose>
        <LegalPlaceholderNotice />

        <ProseSection id="the-deal" heading="1. The deal">
          <ProseText>
            Faite is free. Using it means you agree to these terms; if you don&apos;t
            agree, don&apos;t use it. <ProseTerm>&#123;LEGAL_ENTITY_NAME &mdash; TBD&#125;</ProseTerm>{" "}
            operates Faite and is the other party to this agreement.
          </ProseText>
        </ProseSection>

        <ProseSection id="acceptable-use" heading="2. Acceptable use">
          <ProseText>Don&apos;t use Faite to:</ProseText>
          <ProseList>
            <ProseItem>Break the law, or help anyone else break it.</ProseItem>
            <ProseItem>
              Attack, overload, or try to gain unauthorized access to Faite&apos;s
              infrastructure or another account.
            </ProseItem>
            <ProseItem>
              Abuse the email-capture address (<ProseTerm>in.myfaite.app</ProseTerm>) or the
              contact form to send unsolicited mail through Faite.
            </ProseItem>
          </ProseList>
        </ProseSection>

        <ProseSection id="your-account" heading="3. Your account">
          <ProseText>
            You&apos;re responsible for what happens under your account. Faite is
            local-first: the board works fully offline with no account at all, and
            signing in only begins syncing your data across devices &mdash; see{" "}
            <ProseLink href="/privacy">the privacy policy</ProseLink> for what that
            means for your data.
          </ProseText>
        </ProseSection>

        <ProseSection id="no-warranty" heading="4. No warranty, no SLA">
          <ProseText>
            Faite is provided <ProseTerm>as-is</ProseTerm>, with no warranty of any
            kind and no guaranteed uptime. There is no service-level agreement.
          </ProseText>
          <ProseText>
            This isn&apos;t a hedge &mdash; it reflects how Faite is actually built. The
            app is local-first: everything you do is written to your own device
            first, and syncing to Faite&apos;s servers is an addition, not a
            requirement. If Faite&apos;s servers are ever slow, unreachable, or gone
            entirely, your device still holds a full, working copy of your board.
            That durability comes from the architecture, not from a promise about
            server uptime.
          </ProseText>
        </ProseSection>

        <ProseSection id="termination" heading="5. Ending this agreement">
          <ProseText>
            You can stop using Faite, or delete your account, at any time &mdash; see
            Settings → Account in the app. Faite may suspend or terminate an
            account that violates the acceptable-use section above, with notice
            where practical.
          </ProseText>
        </ProseSection>

        <ProseSection id="liability" heading="6. Limitation of liability">
          <ProseText>
            To the extent permitted by law, Faite and{" "}
            <ProseTerm>&#123;LEGAL_ENTITY_NAME &mdash; TBD&#125;</ProseTerm> are not liable
            for indirect, incidental, or consequential damages arising from your
            use of the app. Faite&apos;s total liability for any claim is limited to
            the amount you paid to use it &mdash; which, today, is zero.
          </ProseText>
        </ProseSection>

        <ProseSection id="governing-law" heading="7. Governing law">
          <ProseText>
            These terms are governed by the laws of{" "}
            <ProseTerm>&#123;GOVERNING_JURISDICTION &mdash; TBD&#125;</ProseTerm>, without
            regard to conflict-of-law principles.
          </ProseText>
        </ProseSection>

        <ProseSection id="changes" heading="8. Changes to these terms">
          <ProseText>
            Faite may update these terms as the product changes. Material changes
            will be reflected in the &ldquo;Last updated&rdquo; date above.
            Questions? <ProseLink href="/contact">Get in touch</ProseLink>.
          </ProseText>
        </ProseSection>

        <RelatedLinks paths={["/privacy"]} />
      </Prose>
    </PageShell>
  );
}
