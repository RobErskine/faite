import { ContactForm } from "@/components/marketing/contact-form";
import { PageShell } from "@/components/marketing/page-shell";
import { Prose, ProseLink, ProseSection, ProseText, RelatedLinks } from "@/components/marketing/prose";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/contact");

export default function ContactPage() {
  return (
    <PageShell path="/contact">
      <Prose>
        <ContactForm />

        <ProseSection id="direct" heading="Direct addresses">
          <ProseText>
            <ProseLink href="mailto:support@myfaite.app">support@myfaite.app</ProseLink> for
            bugs and general questions.
          </ProseText>
          <ProseText>
            For privacy or account-deletion requests, use{" "}
            <ProseLink href="mailto:privacy@myfaite.app">privacy@myfaite.app</ProseLink> instead
            — see <ProseLink href="/privacy">the privacy policy</ProseLink>.
          </ProseText>
        </ProseSection>

        <RelatedLinks paths={["/support"]} />
      </Prose>
    </PageShell>
  );
}
