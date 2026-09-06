import { PageShell } from "@/components/marketing/page-shell";
import {
  Prose,
  ProseLink,
  ProseSection,
  ProseText,
  RelatedLinks,
} from "@/components/marketing/prose";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata("/colophon");

/**
 * The credits page — and, for two of the models below, a licence condition
 * rather than a courtesy.
 *
 * CC0 waives everything; a CC0 asset may ship uncredited. **CC-BY grants the
 * licence only if attribution is given**, so a CC-BY model whose credit is not
 * on a page a user can reach is a model Faite is not licensed to use. That is
 * why this page has a `SITE_PAGES` row and a footer link rather than living in
 * a README.
 *
 * `assets/scene/CREDITS.md` is the machine-side record next to the vendored
 * sources. Adding a CC-BY asset there without adding it here is a licence
 * violation, not a missing nicety.
 */
export default function ColophonPage() {
  return (
    <PageShell path="/colophon">
      <Prose>
        <ProseSection id="scene" heading="The 3D scene">
          <ProseText>
            The room on the home page is built from models made by other
            people and shared freely. Four of them are licensed{" "}
            <ProseLink href="https://creativecommons.org/licenses/by/3.0/">
              CC&nbsp;BY&nbsp;3.0
            </ProseLink>
            , which asks for credit in return &mdash; so here it is, and thank
            you.
          </ProseText>
          <ul>
            <li>
              <em>Featured Content</em> by Kell Condon, CC&nbsp;BY, via{" "}
              <ProseLink href="https://poly.pizza/">Poly Pizza</ProseLink>
              {" "}&mdash; the old television.
            </li>
            <li>
              <em>TV</em> by Jarlan Perez, CC&nbsp;BY, via{" "}
              <ProseLink href="https://poly.pizza/">Poly Pizza</ProseLink>
              {" "}&mdash; the new television.
            </li>
            <li>
              <em>Fish Bowl</em> by sirkitree, CC&nbsp;BY, via{" "}
              <ProseLink href="https://poly.pizza/">Poly Pizza</ProseLink>
              {" "}&mdash; the fish bowl on the sideboard, fish included.
            </li>
            <li>
              <em>books</em> by Tiff Eidmann, CC&nbsp;BY, via{" "}
              <ProseLink href="https://poly.pizza/">Poly Pizza</ProseLink>
              {" "}&mdash; the stack on the wall shelf.
            </li>
            <li>
              <em>Houseplant</em> by{" "}
              <ProseLink href="https://quaternius.com/">Quaternius</ProseLink>,
              CC0.
            </li>
            <li>
              <em>Ultimate House Interior Pack</em> by{" "}
              <ProseLink href="https://quaternius.com/">Quaternius</ProseLink>,
              CC0 &mdash; the furniture.
            </li>
          </ul>
          <ProseText>
            Quaternius releases work under CC0, which asks for nothing at all.
            Crediting it anyway seemed like the least we could do.
          </ProseText>
        </ProseSection>

        <ProseSection id="type" heading="Type">
          <ProseText>
            Faite sets its interface in{" "}
            <ProseLink href="https://www.brailleinstitute.org/freefont/">
              Atkinson Hyperlegible Next
            </ProseLink>
            , which the Braille Institute designed for readers with low vision
            and gives away free and open source.
          </ProseText>
        </ProseSection>

        <ProseSection id="research" heading="Research">
          <ProseText>
            Every claim Faite makes about how planning works is quoted from a
            paper, verbatim, with a link back to it &mdash; alongside the
            popular claims we deliberately refuse to repeat, because the
            productivity genre runs on folklore.
          </ProseText>
        </ProseSection>

        <RelatedLinks paths={["/about", "/help"]} />
      </Prose>
    </PageShell>
  );
}
