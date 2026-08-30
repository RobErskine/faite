import { PageShell } from "@/components/marketing/page-shell";
import { Prose, ProseLink, ProseSection, ProseText, RelatedLinks } from "@/components/marketing/prose";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/download");

/**
 * Where the desktop app's "Get the update" button lands (EI-147,
 * `src/server/desktop/version.ts`'s `downloadUrl`). It is deliberately the
 * only page reachable from inside the Mac app's update bar, which is why it
 * exists before there is a public build to link to: a version check whose
 * button goes nowhere is not a version check.
 *
 * **States no version number on purpose.** This page is also baked into the
 * static export the `.app` ships (`npm run build:static`), so a number here
 * would be frozen at build time and eventually wrong in the one place a user
 * came specifically to trust. The live number is the server's, served from
 * `/api/desktop/version` and shown by the app itself in Settings → About.
 *
 * Kept out of the footer (`footerGroup: null`) until there is a public
 * artifact to hand over — see `src/lib/site.ts`.
 */
export default function DownloadPage() {
  return (
    <PageShell path="/download">
      <Prose>
        <ProseSection id="mac" heading="Faite for Mac">
          <ProseText>
            The Mac app is the same board you use on the web, in a native
            window: it keeps syncing in the background while the window is
            closed, and it works with no network at all, because the board
            reads and writes to your own machine first.
          </ProseText>
        </ProseSection>

        <ProseSection id="getting-a-build" heading="Getting a build">
          <ProseText>
            Downloads aren&apos;t open to everyone yet. The Mac app is in a
            private beta while the update pipeline is finished, and builds go
            out directly to the people testing it.{" "}
            <ProseLink href="/contact">Get in touch</ProseLink> and you&apos;ll
            get the current one.
          </ProseText>
        </ProseSection>

        <ProseSection id="updating" heading="How updating works">
          <ProseText>
            The app checks with this site for the newest build and tells you
            when yours is behind — you&apos;ll see a bar across the top of the
            board, and the version it&apos;s running in Settings under About.
            It doesn&apos;t install updates by itself yet, so an update means
            replacing the app the same way you installed it.
          </ProseText>
          <ProseText>
            Nothing on your board is at risk in the meantime. It lives on your
            Mac, so an out-of-date app still opens and still works &mdash; the
            only thing an old build can lose is the ability to sync with your
            other devices, and it says so plainly when that happens.
          </ProseText>
        </ProseSection>

        <RelatedLinks paths={["/help", "/support"]} />
      </Prose>
    </PageShell>
  );
}
