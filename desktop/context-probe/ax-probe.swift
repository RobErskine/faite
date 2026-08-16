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
//   swift ax-probe.swift            # one-shot capture + latency, JSON to stdout
//   swift ax-probe.swift --watch    # re-capture every 2s (Cmd-Tab between
//                                    # apps while it runs to see it track focus)
//
// Rung 1 (NSWorkspace.frontmostApplication) needs NO permission and always
// works. Rung 2 (AXUIElementCreateApplication -> focused window -> AXWebArea
// -> AXURL) needs the Accessibility permission grant, which requires a human
// clicking through System Settings > Privacy & Security > Accessibility —
// this script cannot grant that to itself. AXIsProcessTrusted() tells us
// which rung we're actually running at without guessing.

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

/// Walks the AX tree from a window element looking for an AXWebArea, since
/// that's where AXURL (the actual browser tab URL) lives — not on the window
/// itself. Depth-limited: browser AX trees are usually shallow (window ->
/// toolbar/webarea siblings), but this is defensive against a pathological
/// tree turning a 400ms-budget capture into a multi-second walk.
func findWebArea(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = 6) -> AXUIElement? {
    if depth > maxDepth { return nil }

    var roleValue: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue) == .success,
       let role = roleValue as? String, role == "AXWebArea" {
        return element
    }

    var childrenValue: AnyObject?
    guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenValue) == .success,
          let children = childrenValue as? [AXUIElement] else {
        return nil
    }

    for child in children {
        if let found = findWebArea(child, depth: depth + 1, maxDepth: maxDepth) {
            return found
        }
    }
    return nil
}

func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    var value: AnyObject?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
        return nil
    }
    return value as? String
}

func capture() -> CaptureResult {
    let start = CFAbsoluteTimeGetCurrent()
    let trusted = AXIsProcessTrusted()

    // Rung 1 — no permission required.
    guard let frontApp = NSWorkspace.shared.frontmostApplication else {
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

    // Spike-only global timeout guard: decision #6 calls for
    // AXUIElementSetMessagingTimeout(~200ms) in the real sidecar so a hung
    // target app can't block the capture window. This prototype sets the
    // same budget to prove the API exists and is worth carrying forward.
    AXUIElementSetMessagingTimeout(appElement, 0.2)

    var windowValue: AnyObject?
    let windowErr = AXUIElementCopyAttributeValue(appElement, kAXFocusedWindowAttribute as CFString, &windowValue)

    var windowTitle: String?
    var documentPath: String?
    var webAreaURL: String?
    var webAreaTitle: String?
    var axError: String?

    if windowErr == .success, let windowElement = windowValue {
        let window = windowElement as! AXUIElement
        windowTitle = stringAttribute(window, kAXTitleAttribute as String)
        documentPath = stringAttribute(window, kAXDocumentAttribute as String)

        if let webArea = findWebArea(window) {
            webAreaURL = stringAttribute(webArea, "AXURL")
            webAreaTitle = stringAttribute(webArea, kAXTitleAttribute as String)
            // AXURL is documented as a CFURL/NSURL, not always a plain
            // string — fall back to reading it as a URL value if the direct
            // string cast came back nil.
            if webAreaURL == nil {
                var urlValue: AnyObject?
                if AXUIElementCopyAttributeValue(webArea, "AXURL" as CFString, &urlValue) == .success {
                    if let url = urlValue as? URL {
                        webAreaURL = url.absoluteString
                    } else if let url = urlValue as? NSURL {
                        webAreaURL = url.absoluteString
                    }
                }
            }
        }
    } else {
        axError = axErrorDescription(windowErr)
    }

    let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000
    return CaptureResult(latencyMs: elapsed, axTrusted: trusted, frontmostApp: frontmost,
                          axWindowTitle: windowTitle, axDocumentPath: documentPath,
                          axWebAreaURL: webAreaURL, axWebAreaTitle: webAreaTitle, axError: axError)
}

func printJSON(_ result: CaptureResult) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(result), let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

let args = CommandLine.arguments
if args.contains("--watch") {
    FileHandle.standardError.write("[ax-probe] watching, Cmd-Tab between apps — Ctrl-C to stop\n".data(using: .utf8)!)
    while true {
        printJSON(capture())
        Thread.sleep(forTimeInterval: 2.0)
    }
} else {
    printJSON(capture())
}
