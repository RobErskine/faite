// D0 spike prototype — NOT production code, NOT the D5 sidecar.
//
// Standalone script answering the D0 "Swift AX prototype" question: can we
// get frontmost-app / window-title / browser-URL via the Accessibility API,
// and how fast? This is deliberately a single throwaway file, not the
// long-lived JSON-lines sidecar decision #6 in the plan doc describes for
// D5 — that's real production shape, this is just "does the API even work
// and what does it cost".
//
// Usage:
//   swift ax-probe.swift               # one-shot capture + latency, JSON to stdout
//   swift ax-probe.swift --watch       # re-capture every 2s (Cmd-Tab between
//                                      # apps while it runs to see it track focus)
//   swift ax-probe.swift --no-enable-ax # skip the Chromium/Gecko AX opt-in below,
//                                      # so a run can be A/B'd against one without it
//
// Rung 1 (NSWorkspace.frontmostApplication) needs NO permission and always
// works. Rung 2 (AXUIElementCreateApplication -> focused window -> AXWebArea
// -> AXURL) needs the Accessibility permission grant, which requires a human
// clicking through System Settings > Privacy & Security > Accessibility —
// this script cannot grant that to itself. AXIsProcessTrusted() tells us
// which rung we're actually running at without guessing.
//
// MEASURED, 2026-08-21, Accessibility granted, over five --watch runs.
// Firefox, Edge, Brave and Arc remain UNTESTED.
//
//                 AXWebArea depth   opt-in needed   result
//   Safari              6                no         11/12, 14/26, 6/7
//   Dia                 1           AXManualAccessibility   0/67 -> 45/45
//   Chrome              8                no         0/26 -> 14/14
//   Warp / System Settings   (none — not browsers)   correctly nothing
//   Jean                -                no         `tauri://localhost`
//
// TWO INDEPENDENT CAUSES, and conflating them cost several runs:
//
//  1. **Dia genuinely needs the opt-in.** 0/67 on a clean control (quit and
//     relaunched, which resets the flag) vs 45/45 with it. `AXManualAccessibility`
//     -> `success`; `AXEnhancedUserInterface` -> `notImplemented`. The flag
//     PERSISTS for the life of the browser process, so enable once per process,
//     not once per capture — and so a control run after a treatment run is
//     contaminated, which is exactly how an earlier pass produced a 35/35
//     "control" that appeared to refute the whole finding.
//
//  2. **Chrome never needed the opt-in — it needed depth.** Chrome rejects
//     both attributes and still answers 14/14. Its page web area sits at
//     depth 8, past the old `maxDepth: 6`, so the walk gave up before reaching
//     it and Chrome looked unsupported for 26 samples. Worse, what it DID find
//     inside 6 levels was `chrome://omnibox-popup.top-chrome/` — the address-bar
//     dropdown — which the old "return the first AXWebArea" logic reported as
//     the page. Both the cap and the pick were wrong; see `findWebAreas`.
//
// Note Safari answers at depth 6 — it was ONE level from being silently broken
// by the same cap. `maxDepth: 12` has margin against the three measured
// browsers but is not proven universal, which is why depth is now reported in
// `webAreas` rather than assumed.
//
// Latency, all fixes in: Safari median 12ms, Chrome 32ms, Dia 31ms; worst
// single sample 396ms (Dia's cold opt-in, the 3-attempt path, paid once per
// browser process). Comfortable against D5's 400ms cap (EI-165) — but only
// after the retry loop stopped firing on apps that never accepted the opt-in,
// which had cost 317-439ms on Warp, Chrome and System Settings alike.

import AppKit
import ApplicationServices
import Foundation

struct CaptureResult: Encodable {
    var latencyMs: Double
    var axTrusted: Bool
    var frontmostApp: FrontmostApp?
    var axWindowTitle: String?
    var axDocumentPath: String?
    var axWebAreaURL: String?
    var axWebAreaTitle: String?
    var axError: String?
    /// Per-attribute result of the Chromium/Gecko AX opt-in — absent entirely
    /// when `--no-enable-ax` was passed, so the JSON says which arm of the A/B
    /// produced it without needing to remember how it was invoked.
    var axEnable: [String: String]?
    /// Every AXWebArea found under the focused window, as "depth:url". The
    /// point is diagnosis: it shows whether a browser exposes nothing at all,
    /// or exposes something we were picking wrong out of. Chrome's omnibox
    /// popup showing up here instead of the page is what motivated it.
    var webAreas: [String]?
    /// How many times the AXWebArea walk ran before it found one (or gave up).
    /// >1 means the tree was still being built when we first looked — the cost
    /// the real sidecar avoids by enabling once per app, not once per capture.
    var webAreaAttempts: Int?
}

struct FrontmostApp: Encodable {
    var name: String?
    var bundleId: String?
    var pid: Int32
}

func axErrorDescription(_ err: AXError) -> String {
    switch err {
    case .success: return "success"
    case .apiDisabled: return "apiDisabled (Accessibility permission not granted)"
    case .noValue: return "noValue (attribute not present on this element)"
    case .cannotComplete: return "cannotComplete (app may be unresponsive or messaging timed out)"
    case .notImplemented: return "notImplemented (app doesn't support this AX attribute)"
    case .invalidUIElement: return "invalidUIElement"
    case .attributeUnsupported: return "attributeUnsupported"
    default: return "AXError(\(err.rawValue))"
    }
}

/// Collects EVERY AXWebArea under a window, with the depth each was found at,
/// instead of returning the first one.
///
/// Returning the first was wrong twice over, and Chrome is what exposed both:
///
///  - **The first web area is often not the page.** Chrome's only non-null
///    URL across 26 samples was `chrome://omnibox-popup.top-chrome/` — the
///    address-bar dropdown, which is itself a web view and sits earlier in the
///    tree than the tab content. A capture that reports the omnibox as "what
///    the user was looking at" is worse than reporting nothing.
///  - **A depth cap of 6 is a guess, not a measurement.** Safari and Dia
///    answer shallow; if Chrome's page web area lives deeper, the old walk
///    would return `nil` and the browser would look unsupported when it isn't.
///    Reporting the depth turns that guess into data — hence `webAreas` in the
///    JSON, which lists what was found and how far down.
///
/// Still depth-limited (a pathological tree must not turn a 400ms capture into
/// a multi-second walk) but no longer at a number nobody checked. Also capped
/// on count, since a page with many iframes has many web areas and we only
/// need enough to pick from.
func findWebAreas(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 12,
                  found: inout [(element: AXUIElement, depth: Int)]) {
    if depth > maxDepth || found.count >= 8 { return }

    var roleValue: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue) == .success,
       let role = roleValue as? String, role == "AXWebArea" {
        found.append((element, depth))
        // Don't descend into a web area — everything below it is page content,
        // and an iframe's web area is not a better answer than its parent's.
        return
    }

    var childrenValue: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenValue) == .success,
          let children = childrenValue as? [AXUIElement] else {
        return
    }

    for child in children {
        findWebAreas(child, depth: depth + 1, maxDepth: maxDepth, found: &found)
    }
}

/// Reads AXURL off a web area. AXURL is documented as a CFURL/NSURL, not
/// always a plain string, so this tries both rather than trusting one cast.
func webAreaURL(_ element: AXUIElement) -> String? {
    if let direct = stringAttribute(element, "AXURL") { return direct }
    var urlValue: AnyObject?
    guard AXUIElementCopyAttributeValue(element, "AXURL" as CFString, &urlValue) == .success else {
        return nil
    }
    if let url = urlValue as? URL { return url.absoluteString }
    if let url = urlValue as? NSURL { return url.absoluteString }
    return nil
}

/// Browser-internal surfaces that are web areas but are never "what the user
/// was looking at" — the omnibox dropdown, devtools, the new-tab page, an
/// extension popup. Kept as a scheme prefix list rather than a bundle-id
/// special case because every Chromium fork reuses these schemes.
func isInternalURL(_ url: String) -> Bool {
    let internalSchemes = ["chrome://", "chrome-extension://", "devtools://",
                           "about:", "edge://", "arc://", "dia://",
                           "safari-resource://", "webkit-fake-url://"]
    return internalSchemes.contains { url.hasPrefix($0) }
}

/// Asks a browser to build its web-content AX tree for us.
///
/// Being AX-trusted is necessary but NOT sufficient for Chromium-family
/// browsers (Chrome, Arc, Dia, Edge, Brave) or Gecko. They keep the expensive
/// web-content tree switched off until a client explicitly asks, so an
/// AX-trusted probe that never asks sees a window with a title and no
/// AXWebArea underneath it — exactly the 0/15 Dia result recorded at the top
/// of this file. Safari builds the tree unconditionally, which is why it was
/// the only browser that worked before this existed.
///
/// Two attributes, tried unconditionally rather than per-bundle-id, because
/// which one a given browser honors is precisely what we don't know yet:
///
///   AXManualAccessibility   Chromium's opt-in for automation clients that
///                           aren't screen readers.
///   AXEnhancedUserInterface The older, broader flag VoiceOver sets; Gecko and
///                           some Electron apps watch this one instead.
///
/// Both results go into the JSON so a run TELLS us which one each browser
/// accepts — `attributeUnsupported` from one and `success` from the other is
/// the answer, and that answer is what docs/CAPTURE.md's support matrix
/// (EI-169) needs. Setting an unsupported attribute is a no-op error, not a
/// side effect, so trying both costs nothing but a round trip.
///
/// Not reverted afterwards: the flag lives on the browser process, and
/// switching it back off would defeat the point for the very next capture.
/// Worth knowing it makes the target browser do more work for as long as it
/// runs — a real privacy/perf note for EI-166's onboarding copy, not a bug.
func enableWebAccessibility(_ appElement: AXUIElement) -> [String: String] {
    var results: [String: String] = [:]
    let trueValue: CFTypeRef = kCFBooleanTrue
    for attribute in ["AXManualAccessibility", "AXEnhancedUserInterface"] {
        let err = AXUIElementSetAttributeValue(appElement, attribute as CFString, trueValue)
        results[attribute] = axErrorDescription(err)
    }
    return results
}

func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
        return nil
    }
    return value as? String
}

/// `frontApp` is passed in rather than read here so `--watch` can supply the
/// value from its activation observer — see `FrontmostTracker` for why polling
/// `NSWorkspace.shared.frontmostApplication` on a loop is not equivalent.
func capture(frontApp: NSRunningApplication?, enableAx: Bool) -> CaptureResult {
    let start = CFAbsoluteTimeGetCurrent()
    let trusted = AXIsProcessTrusted()

    // Rung 1 — no permission required.
    guard let frontApp else {
        let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000
        return CaptureResult(latencyMs: elapsed, axTrusted: trusted, frontmostApp: nil,
                              axWindowTitle: nil, axDocumentPath: nil, axWebAreaURL: nil,
                              axWebAreaTitle: nil, axError: "no frontmost application")
    }

    let frontmost = FrontmostApp(name: frontApp.localizedName, bundleId: frontApp.bundleIdentifier,
                                  pid: frontApp.processIdentifier)

    // Rung 2 — Accessibility permission required. AXIsProcessTrusted() above
    // tells us in advance whether this will actually return data or just
    // apiDisabled errors; we still make the calls either way so the JSON
    // output documents the real AXError, not a guess.
    let appElement = AXUIElementCreateApplication(frontApp.processIdentifier)

    // NOTE: the 200ms messaging budget is NOT set here anymore — it is set
    // once, process-wide, on the system-wide element at startup. See
    // `installMessagingTimeout` for why setting it on `appElement` (which is
    // what this did, and what decision #6's wording invites) is close to
    // useless.

    let axEnable: [String: String]? = enableAx ? enableWebAccessibility(appElement) : nil

    var windowTitle: String?
    var documentPath: String?
    var webAreaURLValue: String?
    var webAreaTitle: String?
    var axError: String?
    var webAreas: [String]?
    var attempts = 0

    // Chromium builds the tree ASYNCHRONOUSLY after being asked, so the first
    // look right after `enableWebAccessibility` can legitimately find nothing
    // even when the ask succeeded. Retry a couple of times before concluding a
    // browser can't do this at all — otherwise the probe reports "no URL" for
    // a browser that would have answered 150ms later, which is the difference
    // between "unsupported" and "supported" in EI-169's matrix.
    //
    // Re-fetches the focused window each attempt rather than reusing the first
    // one: enabling rebuilds the tree under it, and a stale element is exactly
    // the thing that would make a working browser look broken.
    //
    // Only retries when the opt-in actually RETURNED SUCCESS, i.e. when there
    // is a tree being built to wait for. Gating on "we tried to ask" instead
    // charged 2x150ms of sleep to every app that can't be asked: measured at
    // 340ms median for Chrome (which rejects the attribute), 439ms for System
    // Settings and 317ms for Warp — all of it spent waiting for a tree that
    // was never going to appear, on a path budgeted at 400ms total.
    let enabledOk = axEnable?.values.contains("success") ?? false
    let maxAttempts = (enabledOk && trusted) ? 3 : 1
    while attempts < maxAttempts {
        if attempts > 0 { Thread.sleep(forTimeInterval: 0.15) }
        attempts += 1

        var windowValue: AnyObject?
        let windowErr = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowValue)
        guard windowErr == .success, let windowElement = windowValue else {
            axError = axErrorDescription(windowErr)
            continue
        }
        axError = nil

        let window = windowElement as! AXUIElement
        windowTitle = stringAttribute(window, kAXTitleAttribute as String)
        documentPath = stringAttribute(window, kAXDocumentAttribute as String)

        var areas: [(element: AXUIElement, depth: Int)] = []
        findWebAreas(window, found: &areas)
        let resolved = areas.map { (depth: $0.depth, url: webAreaURL($0.element), element: $0.element) }
        webAreas = resolved.map { "\($0.depth):\($0.url ?? "no-AXURL")" }
        if webAreas?.isEmpty == true { webAreas = nil }

        // Prefer the first web area whose URL is a real page. Falling back to
        // the first with ANY url would resurrect the omnibox-popup answer, so
        // the fallback is nil — "we saw web areas but none of them were the
        // page" is a true and more useful report than a confidently wrong URL.
        if let page = resolved.first(where: { url in
            guard let u = url.url else { return false }
            return !isInternalURL(u)
        }) {
            webAreaURLValue = page.url
            webAreaTitle = stringAttribute(page.element, kAXTitleAttribute as String)
        }

        if webAreaURLValue != nil { break }
    }

    let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000
    return CaptureResult(latencyMs: elapsed, axTrusted: trusted, frontmostApp: frontmost,
                          axWindowTitle: windowTitle, axDocumentPath: documentPath,
                          axWebAreaURL: webAreaURLValue, axWebAreaTitle: webAreaTitle, axError: axError,
                          axEnable: axEnable, webAreas: webAreas, webAreaAttempts: attempts)
}

func printJSON(_ result: CaptureResult) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(result), let json = String(data: data, encoding: .utf8) {
        print(json)
        // stdout is block-buffered when redirected to a file, which is how
        // every useful `--watch` run is invoked. Without this, a run that ends
        // in Ctrl-C or `kill` loses whatever was still in the buffer and
        // truncates the last record mid-object — observed, not theoretical.
        fflush(stdout)
    }
}

/// Keeps `frontmostApplication` actually current.
///
/// The first `--watch` implementation was `while true { capture(); sleep(2) }`,
/// and every one of its 38 samples reported the terminal it was launched from
/// even while the human Cmd-Tabbed through browsers. `NSWorkspace` learns
/// about app activation from workspace notifications, which are delivered on a
/// RUN LOOP — a CLI tool that only sleeps never processes them, so
/// `frontmostApplication` answers with whatever was frontmost at launch,
/// forever. The window TITLE kept updating (it's re-read live off that stale
/// pid), which is what made the bug look like a permissions problem instead of
/// a run-loop one.
///
/// So: observe `didActivateApplicationNotification` and hold the answer,
/// rather than ask for it. This is also, not coincidentally, the mechanism
/// EI-164 specifies for the real sidecar — where the same observer additionally
/// has to ignore Faite's own capture window, so the captured context is the app
/// the user was looking at rather than the one that just took focus from them.
/// This prototype has no window to ignore, so it holds every activation.
final class FrontmostTracker {
    private(set) var current: NSRunningApplication?

    init() {
        current = NSWorkspace.shared.frontmostApplication
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }
            self?.current = app
        }
    }
}

/// Bounds EVERY AX message this process sends, not just one element's.
///
/// decision #6 says "set AXUIElementSetMessagingTimeout to ~200ms", and the
/// obvious reading — set it on the application element you just created — is
/// what this probe did, and it is nearly a no-op. Apple's own wording:
///
///   "Setting the timeout on another accessibility object sets it only for
///    that object, not for other accessibility objects that are equal to it."
///   "Pass the system-wide accessibility object ... if you want to set the
///    timeout globally for this process."
///
/// So the app element was bounded and every element REACHED THROUGH it — the
/// focused window, each child in the `findWebArea` walk, the AXWebArea, the
/// AXURL read — silently used the 6-second system default instead. That is
/// not theoretical: a Safari sample in the 2026-08-21 run took **6120ms**,
/// which is that default timing out, on a capture path budgeted at 400ms.
///
/// This matters more for D5 than for this prototype. EI-165's supervisor cap
/// is the outer bound, but a supervisor that has to hard-kill a sidecar
/// wedged for 6s is a worse design than one whose sidecar cannot wedge for
/// longer than 200ms per message in the first place. Set it here, at the only
/// scope that actually does anything.
func installMessagingTimeout(_ seconds: Float) {
    AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), seconds)
}

installMessagingTimeout(0.2)

let args = CommandLine.arguments
let enableAx = !args.contains("--no-enable-ax")

if args.contains("--watch") {
    let mode = enableAx ? "enabling browser AX" : "--no-enable-ax (control run)"
    FileHandle.standardError.write(
        "[ax-probe] watching (\(mode)), Cmd-Tab between apps — Ctrl-C to stop\n".data(using: .utf8)!)

    let tracker = FrontmostTracker()
    printJSON(capture(frontApp: tracker.current, enableAx: enableAx))
    Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
        printJSON(capture(frontApp: tracker.current, enableAx: enableAx))
    }
    // Not `Thread.sleep` — see FrontmostTracker. Running the run loop is what
    // makes both the timer and the activation observer fire at all.
    RunLoop.main.run()
} else {
    printJSON(capture(frontApp: NSWorkspace.shared.frontmostApplication, enableAx: enableAx))
}
