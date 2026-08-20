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

export const metadata = pageMetadata("/privacy");

export default function PrivacyPage() {
  return (
    <PageShell path="/privacy">
      <Prose>
        <LegalPlaceholderNotice />

        <ProseSection id="short-version" heading="1. The short version">
          <ProseText>
            Signed out, everything you do in Faite lives in your browser&apos;s
            local storage (IndexedDB) and <ProseTerm>nothing is transmitted
            anywhere</ProseTerm>. Sync to Faite&apos;s servers begins only when you
            sign in.
          </ProseText>
          <ProseText>
            Faite runs no analytics, no error tracking, no advertising
            technology, no tracking pixels, and does not use your content to
            train any AI model. There is nothing in this app whose job is to
            watch what you do.
          </ProseText>
        </ProseSection>

        <ProseSection id="what-we-collect" heading="2. What&#39;s stored, and where">
          <ProseText>
            Faite splits data across two stores. Account information &mdash;
            email, display name, avatar image, and (for email/password
            accounts) a hashed password &mdash; lives in a shared database used
            only for sign-in. If you sign in with GitHub or Google, Faite also
            holds the connection tokens for that provider, and your session
            carries the IP address and browser user-agent of each device
            you&apos;re signed in from.
          </ProseText>
          <ProseText>
            Everything you actually make in Faite &mdash; to-do titles and
            descriptions, day notes, list/tab/label names, saved places
            (including addresses and coordinates), your timezone, and any
            avatar photo you upload &mdash; lives in a private data store
            created just for your account, addressed by your account id and
            reachable only by requests carrying your session.
          </ProseText>
        </ProseSection>

        <ProseSection id="isolation" heading="3. Isolation">
          <ProseText>
            Each account&apos;s data store is addressed by your account id, so a
            request can only ever read or write its own account&apos;s data.
            Faite is solo-user today &mdash; there is no sharing UI, no
            permission model, and no way for another account to read yours.
          </ProseText>
        </ProseSection>

        <ProseSection id="subprocessors" heading="4. Who else touches your data">
          <ProseText>
            Faite runs entirely on Cloudflare&apos;s infrastructure &mdash; compute,
            both databases, transactional email, and the security check on the
            contact form. Beyond Cloudflare:
          </ProseText>
          <ProseList>
            <ProseItem>
              <ProseTerm>GitHub</ProseTerm> and <ProseTerm>Google</ProseTerm> &mdash;
              only if you choose to sign in with one of them.
            </ProseItem>
            <ProseItem>
              <ProseTerm>Google Places API</ProseTerm> &mdash; only when you look up
              an address for a saved place. See the next section for how
              that call is handled.
            </ProseItem>
          </ProseList>
        </ProseSection>

        <ProseSection id="location-lookup" heading="5. How location lookup actually works">
          <ProseText>
            Typing an address into a location field routes through Faite&apos;s
            own server, using Faite&apos;s own API key &mdash; <ProseTerm>your IP
            address is never sent to Google</ProseTerm>. Only the text you typed
            and a short-lived session token leave Faite&apos;s server. If
            you&apos;re signed out, there is no lookup at all: the text you type
            is saved as-is, with no request made anywhere.
          </ProseText>
        </ProseSection>

        <ProseSection id="cookies" heading="6. Cookies">
          <ProseText>
            Faite sets one cookie: a session cookie that keeps you signed in.
            It is strictly necessary for the app to function, which is why
            there&apos;s no cookie-consent banner &mdash; there&apos;s nothing to opt
            into.
          </ProseText>
        </ProseSection>

        <ProseSection id="logs" heading="7. Logs">
          <ProseText>
            Faite&apos;s hosting includes standard request logging. One
            deliberate exception: if Faite is ever unable to send you an
            email (password reset, email verification), the failure is
            logged with your email address, the email&apos;s subject line, and
            the reason it couldn&apos;t send &mdash; but never the email&apos;s
            content, and never a reset or verification link.
          </ProseText>
        </ProseSection>

        <ProseSection id="retention" heading="8. How long your data is kept">
          <ProseText>
            Faite keeps your data for as long as your account exists.
            Deleting an individual to-do, list, or tab removes it from
            everywhere you can see it, but Faite keeps an internal record
            that it once existed &mdash; the same way most apps with
            multi-device sync do &mdash; until you delete your account (below).
            Archiving a list or tab is different from deleting it: an
            archived list keeps its to-dos, and you can bring it back.
          </ProseText>
        </ProseSection>

        <ProseSection id="deletion" heading="9. Deleting your account">
          <ProseText>
            Settings → Account → Delete account permanently deletes your
            account and everything in it, on every device. This is
            different from Settings → Developer → Reset, which clears your
            board&apos;s content but leaves your account and sign-in intact &mdash;
            reset is for starting your board over, not for leaving Faite.
          </ProseText>
        </ProseSection>

        <ProseSection id="export" heading="10. Exporting your data">
          <ProseText>
            Faite does not yet have a self-serve data export tool. If you&apos;d
            like a copy of your data, <ProseLink href="/contact">get in touch</ProseLink>{" "}
            and we&apos;ll help.
          </ProseText>
        </ProseSection>

        <ProseSection id="security" heading="11. Security">
          <ProseText>
            All traffic to Faite is encrypted in transit. Passwords are
            hashed, never stored in plain text. Session secrets and
            third-party credentials are stored as encrypted platform
            secrets, not in the codebase.
          </ProseText>
        </ProseSection>

        <ProseSection id="more" heading="12. Children, international use, and changes">
          <ProseText>
            Faite is not directed at children under 13, and does not
            knowingly collect their data. Faite&apos;s infrastructure runs on a
            global network, so your data may be processed outside your own
            country. Faite may update this policy as the product changes;
            material changes will be reflected in the &ldquo;Last
            updated&rdquo; date above.
          </ProseText>
          <ProseText>
            Questions, or a privacy or deletion request?{" "}
            <ProseLink href="/contact">Get in touch</ProseLink>.
          </ProseText>
        </ProseSection>

        <RelatedLinks paths={["/terms"]} />
      </Prose>
    </PageShell>
  );
}
