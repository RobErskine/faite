# EI-254 — hot asset bundle spike

Ticket: https://linear.app/rob-erskine/issue/EI-254/d-spike-hot-asset-bundle-a-web-deploy-reaches-installed-desktop-apps
Branch: `rob/ei-254-d-spike-hot-asset-bundle-a-web-deploy-reaches-installed`

**Goal of the spike, in one line:** prove a web deploy can reach an installed
`.app` without a `cargo build`, without changing the webview's origin, and
without ever producing an app that fails to boot.

This is a **D0-style spike**. The probe code answers questions and then leaves;
`docs/DESKTOP.md` §3 is the template and `d0_probe.rs` is the precedent for
deleting it afterwards. What survives is findings in `docs/DESKTOP.md` and a
go/no-go on decision #2.

## Verified before writing any code (2026-08-31)

Against the pinned toolchain, not docs from memory:

- `tauri` **2.11.5** (Cargo.lock), `tauri-utils` 2.9.3.
- `Context::set_assets(&mut self, Box<dyn Assets<R>>) -> Box<dyn Assets<R>>`
  exists at `tauri-2.11.5/src/lib.rs:423`, and **returns the previous
  provider** — the embedded fallback is handed to us, we don't have to
  reconstruct it.
- `trait Assets<R>` (`tauri-2.11.5/src/lib.rs:313`) is four methods:
  `setup` (defaulted), `get`, `iter`, `csp_hashes`.
- `AssetKey` is a **rooted, unix-separator, no-trailing-slash** path
  (`tauri-utils-2.9.3/src/assets.rs:23`). So `/board.html`, `/_next/static/…`
  — a disk provider strips the leading `/` and joins onto its root.
- Insert point is `src-tauri/src/lib.rs:116`'s `tauri::generate_context!()`.

## The one API wrinkle, and the shape that solves it

`set_assets` hands back the old provider, but our new provider needs to *hold*
that old provider as its fallback — a chicken-and-egg. Resolved with two calls
and a throwaway:

```rust
let embedded = context.set_assets(Box::new(NoAssets));      // extract
context.set_assets(Box::new(DirAssets::new(dir, embedded))); // install, drop the stub
```

Not a hack worth hiding — it is the documented API used the only way it can be
used when the replacement wraps the original.

## Design constraints this spike must not violate

1. **Origin never changes.** The whole reason to prefer `set_assets` over a
   custom scheme is that the page stays on `tauri://localhost`, so Dexie,
   auth, capabilities and CSP behave exactly as a stock build. Any finding
   that the origin moved is a FAIL of the whole approach, not a detail.
2. **The app boots, always.** A missing, partial, or corrupt bundle directory
   must fall through to the embedded assets silently. Same principle as
   EI-147's `evaluateUpdate`: fail towards *working*, never towards a brick.
3. **No new runtime deps** for the probe. macOS app-data path is derived from
   `$HOME` + the config's `identifier`.

## Steps

- [x] S0. Read `.ai/lessons.md`, `docs/DESKTOP.md` §2/§3/§12, verify the API
      against the vendored crate source (above).
- [x] S1. `src-tauri/src/hot_assets.rs` — `DirAssets` (disk-backed, embedded
      fallback, traversal guard, sanity check) + `NoAssets` stub.
- [x] S2. Wire into `lib.rs` behind the bundle directory simply existing.
- [x] S3. **Q1 — swap works, data survives.** Build once. Copy `.next-static`
      into the bundle dir. Edit a file there by hand. Relaunch (NO cargo
      build) and see the edit. Confirm the board's existing Dexie data is
      still there.
- [x] S4. **Q2 — both webviews.** Main window and the D2b hidden background
      window both serve from the swap; window-state/deep-link/keychain
      unaffected.
- [x] S5. **Q3 — atomicity.** `kill -9` mid-write; delete a file from the
      bundle mid-session; point the dir at garbage. App boots every time.
- [ ] S6. **Q4 — CSP.** Swapped HTML runs under the unmodified conf CSP.
- [x] S7. **Q7 — numbers.** Bundle size gzipped, swap cost, binary delta.
- [ ] S8. Findings → `docs/DESKTOP.md` §13; delete the probe; go/no-go.

## Open questions to answer with evidence, not opinion

- Does `iter()` get called on a real boot at all? (Implemented honestly
  either way, but the answer decides how much it matters.)
- Is `csp_hashes` → empty actually safe here? Expected yes — the conf CSP
  ships `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, so nothing depends
  on hashes. **Verify, don't assume** (lessons.md: prose drifts, tests don't).
- Does the window-state plugin's restore interact badly with a relaunch that
  swaps assets underneath it?

## Not in this spike

Downloading, signature verification, the server manifest, and the apply-on-
relaunch UX. Those are the *build* if the spike says go. The spike's only job
is proving the swap is sound and the fallback is unbreakable.

## Status after session 1 (2026-08-31)

S1–S5 and S7 done; findings in `docs/DESKTOP.md` §13. The mechanism works and
the fallback holds — a web change reached the installed app with no
`cargo build`.

S4 (both webviews) and the Dexie-survival half of S3 are answered **by
construction** rather than by observation: the provider is per-`App` so both
windows share it, and the origin never moves so IndexedDB cannot be orphaned.
Both want a display session to confirm, per §4's standing caveat.

Biggest thing learned, now driving the design: **per-file fallback mixes
builds.** All-or-nothing manifest verification before activation is required —
see §13.3.

Left for the build phase (not the spike): download, signature verification,
the server manifest, and the apply-on-relaunch UX.
