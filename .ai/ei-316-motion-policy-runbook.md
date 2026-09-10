# EI-316 — V5a: motion policy, springs and inertia

Branch `rob/ei-316-v5a-motion-policy-springs-and-inertia-hover-wash-traveling`.
Ticket + Handoff comment: <https://linear.app/rob-erskine/issue/EI-316>

Lands the spring policy that EI-270 (V5) will be written against. Rejects
Fluid Hover — reasons in the Handoff comment, not repeated here.

---

## Findings that changed the plan

**F1 — one `hover-reveal` utility cannot own the `group-hover` part.**
The four reveal sites sit under **three different group scopes**:
`group/column` (`board-column.tsx:676`), `group/tab` (`tab-strip.tsx:322`),
and a bare `group` (`todo-card.tsx:422`). A Tailwind `@utility` cannot
parameterize the group name, so a single utility carrying
`group-hover/…:opacity-100` is impossible.

**Resolution:** the utility owns the parts that do not vary —
`opacity-0`, `transition-opacity`, `touch:opacity-100`,
`focus-visible:opacity-100`. Each site keeps its own explicit
`group-hover/<scope>:opacity-100` (plus `group-focus-within:opacity-100`
where it already has one). Still collapses 3 classes to 1 at every site, and
the `touch:` fallback — the thing the guard exists for — moves into one place
where it cannot be forgotten.

**F2 — `.ai/lessons.md` L354 (tailwind-merge) applies to the utility.**
tailwind-merge does not know `hover-reveal` conflicts with `opacity-*`. Today
that is safe: `board-column.tsx:1104` puts `opacity-100` and the reveal in
**opposite branches of a ternary**, so they never coexist. Do not hand
`hover-reveal` to a component that also takes an `opacity-*` override — the
loser would be decided by emit order, invisibly.

**F3 — L1202: lead with the visible change.** The V milestone already burned
two hourly limits by shipping tokens ahead of anything a user could see. So
the token, the wash, and the tab highlight go in **one PR**, and verification
is before/after screenshots, not a green suite.

**F4 — L1294: never trust emulated reduced motion.** Playwright's
`reducedMotion: "reduce"` did not reach `matchMedia` in EI-275. Any
reduced-motion assertion must first `page.evaluate` the media query and prove
the emulation landed.

---

## The curve

Generated from a unit-step damped harmonic oscillator, `m=1, k=500, c=31`
→ ζ ≈ 0.693, ω ≈ 22.36 rad/s. **4.9% overshoot**, settled to within 0.1% at
350 ms so the curve lands on `1` with no snap. 24 stops, 341 chars.

```
x(t) = 1 − e^(−ζωt)·(cos(ω_d t) + (ζ/√(1−ζ²))·sin(ω_d t)),  ω_d = ω√(1−ζ²)
```

Regenerate by re-running that with new `k`/`c`; keep the tail under ~0.1% at
the chosen duration or the last stop snaps.

---

## Steps

### 1. `docs/DESIGN.md` §4 — the policy

- Reword the ceiling. **Do not delete the number:**
  arrival stays under `--dur-slow` (260 ms); a spring's settle tail may run to
  ~400 ms, `transform` only; fixed durations still govern color, opacity, and
  anything that reflows.
- Add: springs go on `transform`; never `background-color`; never overshoot
  `opacity` (flickers past 0 and 1).
- Add: reduced motion drops the **overshoot**, not just the animation.
- Add `--ease-spring-travel` to the token table.
- Keep verbatim: `motion-reduce`, transition-not-state,
  spectrum-changes-color, no-streaks, prefer-transform.

### 2. `src/app/globals.css` — the token

Add to `@theme inline` beside `--ease-out-soft` (~line 145), with the
parameters in a comment. Keep `--ease-spring` — `--animate-check` uses it.

### 3. Hover wash — asymmetric, no spring

Base rule `duration-(--dur-base)` (fade-out), `hover:` `duration-(--dur-fast)`
(fade-in), so a sweep leaves a wake instead of a strobe.

- `todo-card.tsx:429` — replaces the hardcoded `duration-100`
- `tab-strip.tsx:331`, `board-column.tsx:1327`
- `ui/context-menu.tsx`, `ui/dropdown-menu.tsx`

### 4. Traveling tab highlight

Absolute div behind the pills; `translateX()` + `width` from the hovered
pill's `offsetLeft`/`offsetWidth`; `ease-spring-travel`. Carries
`motion-reduce:transition-none`. Supersedes EI-270's underline line
(`tab-strip.tsx:382-388`) — **update EI-270 when this lands**.

### 5. Collapse the reveals (per F1)

`@utility hover-reveal` in `globals.css`, applied at `board-column.tsx:1104`,
`rail-collapse-button.tsx:39`, `tab-strip.tsx:402` and `:474`,
`todo-card.tsx:519-525`.

**Rewrite `src/components/touch-affordance.test.ts` in the same commit.** The
current matcher needs `opacity-0` **and** `group-hover` in one literal; once
`opacity-0` moves into the utility it matches nothing and passes **vacuously**.
New shape: a literal with `group-hover` + `opacity-100` must also carry
`hover-reveal` or `touch:`; plus a test that the utility's own definition in
`globals.css` contains the touch fallback. Leave `demo-tooltip.tsx` alone —
marketing zero-JS graph.

---

## Check

- `npm run typecheck && npm run lint`
- `npx vitest run src/components/touch-affordance.test.ts src/components/board/todo-card.test.tsx src/components/board/board-column.test.tsx`
- `npm run e2e:ci` (the gate) + `npx playwright test e2e/touch-affordances.spec.ts`
- Screenshots (F3): sweep a column of 10+ to-dos; sweep the tab strip; OS
  reduced motion on.
