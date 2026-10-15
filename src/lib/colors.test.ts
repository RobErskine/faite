import { describe, expect, it } from "vitest";
import { ACCENT_COLORS, LABEL_INK_HUE_SHARE, effectiveListColor, labelChipStyle, labelInk } from "./colors";

const PINK = "#d6409f";
const BLUE = "#3e63dd";

describe("effectiveListColor", () => {
  it("returns the list's own color when it has one", () => {
    const tabsById = new Map([["tab-1", { color: PINK }]]);
    expect(effectiveListColor({ color: BLUE, tabId: "tab-1" }, tabsById)).toBe(BLUE);
  });

  it("falls back to the owning tab's color when the list has none", () => {
    const tabsById = new Map([["tab-1", { color: PINK }]]);
    expect(effectiveListColor({ color: null, tabId: "tab-1" }, tabsById)).toBe(PINK);
  });

  it("is null when neither the list nor its tab has a color", () => {
    const tabsById = new Map([["tab-1", { color: null }]]);
    expect(effectiveListColor({ color: null, tabId: "tab-1" }, tabsById)).toBeNull();
  });

  it("is null for a list with no tab at all — Backlog inherits nothing", () => {
    const tabsById = new Map([["tab-1", { color: PINK }]]);
    expect(effectiveListColor({ color: null, tabId: null }, tabsById)).toBeNull();
  });

  it("is null for a list whose tab is missing from the map", () => {
    expect(effectiveListColor({ color: null, tabId: "gone" }, new Map())).toBeNull();
  });

  it("resolves through a map built from archived tabs just as well as live ones", () => {
    // `tabsById` is deliberately just a map — it does not know or care whether
    // the tab it holds is live or archived. Callers are responsible for
    // widening it to include archived tabs (see use-board-data.ts), and this
    // proves the resolver itself needs no special case for that.
    const archivedTabsById = new Map([["filed-tab", { color: PINK }]]);
    expect(effectiveListColor({ color: null, tabId: "filed-tab" }, archivedTabsById)).toBe(PINK);
  });

  it("is null for a null list", () => {
    expect(effectiveListColor(null, new Map())).toBeNull();
  });
});

describe("label chip ink (EI-395)", () => {
  it("mixes the hue into the foreground for the text, and keeps the hue on tint and edge", () => {
    expect(labelChipStyle("#ffb224")).toEqual({
      backgroundColor: "#ffb22420",
      borderColor: "#ffb22459",
      color: "color-mix(in oklab, #ffb224 30%, var(--foreground))",
    });
    expect(labelInk("not a color")).toBeUndefined();
    expect(labelChipStyle(null)).toBeUndefined();
  });

  /*
    The number behind LABEL_INK_HUE_SHARE, recomputed rather than trusted:
    the browser's own math (oklab mix, sRGB alpha compositing, WCAG
    luminance) for every preset, on every surface a chip sits on — the page,
    today's card, Overflow's rail — with and without the hover wash and a
    list's 5% wash under it, in both themes. If someone nudges the share up
    for more color, this says by how much it stopped passing.
  */
  it("passes 4.5:1 for every preset, on every surface, in both themes", () => {
    const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const toGam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
    type RGB = [number, number, number];
    const oklabToRgb = ([L, a, b]: RGB): RGB => {
      const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
      return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
      ].map((x) => Math.min(1, Math.max(0, toGam(x)))) as RGB;
    };
    const rgbToOklab = (rgb: RGB): RGB => {
      const [r, g, b] = rgb.map(toLin);
      const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
      const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
      const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
      return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
      ];
    };
    const gray = (L: number) => oklabToRgb([L, 0, 0]);
    const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
    const over = (fg: RGB, alpha: number, bg: RGB): RGB =>
      fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as RGB;
    const lum = (c: RGB) => {
      const [r, g, b] = c.map(toLin);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (x: RGB, y: RGB) => {
      const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    const mix = (a: RGB, share: number, b: RGB) => {
      const [A, B] = [rgbToOklab(a), rgbToOklab(b)];
      return oklabToRgb(A.map((v, i) => v * share + B[i] * (1 - share)) as RGB);
    };

    // globals.css: --foreground, then --background, --surface-1, --surface-0.
    const themes = {
      light: { fg: gray(0.145), surfaces: [gray(1), gray(1), gray(0.985)] },
      dark: { fg: gray(0.985), surfaces: [gray(0.145), gray(0.225), gray(0.19)] },
    };
    const presets = ACCENT_COLORS.map((c) => c.value);
    let worst = Infinity;
    for (const { fg, surfaces } of Object.values(themes)) {
      for (const surface of surfaces) {
        for (const listWash of [null, ...presets]) {
          for (const hover of [0, 0.05]) {
            let backdrop = listWash ? over(hex(listWash), 13 / 255, surface) : surface;
            if (hover) backdrop = over(fg, hover, backdrop);
            for (const hue of presets) {
              const chip = over(hex(hue), 32 / 255, backdrop);
              const ink = mix(hex(hue), LABEL_INK_HUE_SHARE / 100, fg);
              worst = Math.min(worst, contrast(ink, chip));
            }
          }
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });
});
