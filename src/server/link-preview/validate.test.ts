import { describe, expect, it } from "vitest";
import { validateLinkPreviewUrl } from "./validate";

describe("validateLinkPreviewUrl", () => {
  it("accepts an ordinary https URL", () => {
    const url = validateLinkPreviewUrl("https://developers.cloudflare.com/workers/");
    expect(url?.toString()).toBe("https://developers.cloudflare.com/workers/");
  });

  it("accepts http", () => {
    expect(validateLinkPreviewUrl("http://example.com")).not.toBeNull();
  });

  it("strips the fragment", () => {
    const url = validateLinkPreviewUrl("https://example.com/page#section");
    expect(url?.hash).toBe("");
  });

  it("rejects null", () => {
    expect(validateLinkPreviewUrl(null)).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(validateLinkPreviewUrl("")).toBeNull();
  });

  it("rejects a string over the length cap", () => {
    const huge = "https://example.com/" + "a".repeat(3000);
    expect(validateLinkPreviewUrl(huge)).toBeNull();
  });

  it("rejects garbage new URL() itself refuses", () => {
    expect(validateLinkPreviewUrl("not a url")).toBeNull();
  });

  it("rejects file:", () => {
    expect(validateLinkPreviewUrl("file:///etc/passwd")).toBeNull();
  });

  it("rejects javascript:", () => {
    expect(validateLinkPreviewUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects ftp:", () => {
    expect(validateLinkPreviewUrl("ftp://example.com/file")).toBeNull();
  });

  it("rejects data:", () => {
    expect(validateLinkPreviewUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects localhost", () => {
    expect(validateLinkPreviewUrl("http://localhost:3000")).toBeNull();
  });

  it("rejects 127.0.0.1", () => {
    expect(validateLinkPreviewUrl("http://127.0.0.1")).toBeNull();
  });

  it("rejects IPv6 loopback", () => {
    expect(validateLinkPreviewUrl("http://[::1]")).toBeNull();
  });

  it("rejects private 10.x", () => {
    expect(validateLinkPreviewUrl("http://10.0.0.5")).toBeNull();
  });

  it("rejects private 172.16-31.x", () => {
    expect(validateLinkPreviewUrl("http://172.20.0.1")).toBeNull();
  });

  it("accepts public 172.x outside the private range", () => {
    expect(validateLinkPreviewUrl("http://172.64.0.1")).not.toBeNull();
  });

  it("rejects private 192.168.x", () => {
    expect(validateLinkPreviewUrl("http://192.168.1.1")).toBeNull();
  });

  it("rejects the cloud metadata address", () => {
    expect(validateLinkPreviewUrl("http://169.254.169.254")).toBeNull();
  });
});
