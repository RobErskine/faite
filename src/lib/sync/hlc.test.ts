import { describe, expect, it } from "vitest";
import { compareHlc, decodeHlc, encodeHlc, localEvent, receiveEvent } from "./hlc";

const NODE_A = "aaaa1111";
const NODE_B = "bbbb2222";

describe("encodeHlc / decodeHlc", () => {
  it("round-trips", () => {
    const parts = { phys: 1_700_000_000_000, counter: 42, nodeId: NODE_A };
    expect(decodeHlc(encodeHlc(parts))).toEqual(parts);
  });

  it("zero-pads phys and counter to fixed width", () => {
    expect(encodeHlc({ phys: 1, counter: 1, nodeId: NODE_A })).toBe(
      `000000000001:0001:${NODE_A}`,
    );
  });
});

describe("localEvent", () => {
  it("starts a fresh clock from wallClock with counter 0", () => {
    const hlc = localEvent(null, 1000, NODE_A);
    expect(decodeHlc(hlc)).toEqual({ phys: 1000, counter: 0, nodeId: NODE_A });
  });

  it("under a frozen wall clock, the counter advances instead of phys", () => {
    let hlc = localEvent(null, 1000, NODE_A);
    hlc = localEvent(hlc, 1000, NODE_A);
    hlc = localEvent(hlc, 1000, NODE_A);
    expect(decodeHlc(hlc)).toEqual({ phys: 1000, counter: 2, nodeId: NODE_A });
  });

  it("a forward wall-clock jump resets the counter and advances phys", () => {
    let hlc = localEvent(null, 1000, NODE_A);
    hlc = localEvent(hlc, 1000, NODE_A); // counter -> 1
    hlc = localEvent(hlc, 5000, NODE_A);
    expect(decodeHlc(hlc)).toEqual({ phys: 5000, counter: 0, nodeId: NODE_A });
  });

  it("a backwards wall-clock jump (NTP correction) still advances monotonically", () => {
    // The classic bug: Date.now() alone would silently go backwards here.
    let hlc = localEvent(null, 10_000, NODE_A);
    hlc = localEvent(hlc, 10_000, NODE_A); // counter -> 1, phys stays 10_000
    const before = hlc;
    hlc = localEvent(hlc, 3_000, NODE_A); // wall clock jumped backwards
    expect(compareHlc(hlc, before) > 0).toBe(true);
    expect(decodeHlc(hlc)).toEqual({ phys: 10_000, counter: 2, nodeId: NODE_A });
  });

  it("pushes phys forward by 1ms instead of wrapping the counter on overflow", () => {
    let hlc = encodeHlc({ phys: 1000, counter: 0xfffe, nodeId: NODE_A });
    hlc = localEvent(hlc, 1000, NODE_A); // counter -> 0xffff, still fits
    expect(decodeHlc(hlc)).toEqual({ phys: 1000, counter: 0xffff, nodeId: NODE_A });
    hlc = localEvent(hlc, 1000, NODE_A); // would overflow past 16 bits
    expect(decodeHlc(hlc)).toEqual({ phys: 1001, counter: 0, nodeId: NODE_A });
  });
});

describe("receiveEvent", () => {
  it("adopts the remote HLC outright when it is far ahead", () => {
    const local = localEvent(null, 1000, NODE_A);
    const remote = localEvent(null, 50_000, NODE_B);
    const merged = receiveEvent(local, remote, 1000, NODE_A);
    expect(decodeHlc(merged)).toEqual({ phys: 50_000, counter: 1, nodeId: NODE_A });
  });

  it("bumps the local counter when local phys wins the max", () => {
    const local = localEvent(null, 50_000, NODE_A);
    const remote = localEvent(null, 1_000, NODE_B);
    const merged = receiveEvent(local, remote, 1000, NODE_A);
    expect(decodeHlc(merged)).toEqual({ phys: 50_000, counter: 1, nodeId: NODE_A });
  });

  it("takes the max of both counters + 1 when phys ties across local and remote", () => {
    const local = encodeHlc({ phys: 5000, counter: 3, nodeId: NODE_A });
    const remote = encodeHlc({ phys: 5000, counter: 7, nodeId: NODE_B });
    const merged = receiveEvent(local, remote, 1000, NODE_A);
    expect(decodeHlc(merged)).toEqual({ phys: 5000, counter: 8, nodeId: NODE_A });
  });

  it("resets the counter to 0 when the wall clock alone exceeds both", () => {
    const local = encodeHlc({ phys: 1000, counter: 9, nodeId: NODE_A });
    const remote = encodeHlc({ phys: 2000, counter: 4, nodeId: NODE_B });
    const merged = receiveEvent(local, remote, 9_000, NODE_A);
    expect(decodeHlc(merged)).toEqual({ phys: 9000, counter: 0, nodeId: NODE_A });
  });

  it("overflow on receive also pushes phys forward instead of wrapping", () => {
    const local = encodeHlc({ phys: 5000, counter: 0xffff, nodeId: NODE_A });
    const remote = encodeHlc({ phys: 5000, counter: 0xffff, nodeId: NODE_B });
    const merged = receiveEvent(local, remote, 1000, NODE_A);
    expect(decodeHlc(merged)).toEqual({ phys: 5001, counter: 0, nodeId: NODE_A });
  });
});

describe("compareHlc", () => {
  it("agrees with numeric phys order across a frozen clock, a backward jump, and overflow", () => {
    const seq: string[] = [];
    let hlc = localEvent(null, 1000, NODE_A);
    seq.push(hlc);
    hlc = localEvent(hlc, 1000, NODE_A); // counter tick
    seq.push(hlc);
    hlc = localEvent(hlc, 500, NODE_A); // backwards jump
    seq.push(hlc);
    hlc = encodeHlc({ phys: 1000, counter: 0xffff, nodeId: NODE_A });
    seq.push(hlc);
    hlc = localEvent(hlc, 1000, NODE_A); // overflow -> phys+1
    seq.push(hlc);

    for (let i = 1; i < seq.length; i++) {
      expect(compareHlc(seq[i], seq[i - 1]) > 0).toBe(true);
    }
    // Lexicographic string order must agree with compareHlc.
    const sorted = [...seq].sort();
    expect(sorted).toEqual([...seq].sort((a, b) => compareHlc(a, b)));
  });

  it("ties break deterministically by nodeId when phys and counter are identical", () => {
    const a = encodeHlc({ phys: 1000, counter: 1, nodeId: NODE_A });
    const b = encodeHlc({ phys: 1000, counter: 1, nodeId: NODE_B });
    expect(compareHlc(a, b) < 0).toBe(true);
    expect(compareHlc(b, a) > 0).toBe(true);
    expect(compareHlc(a, a)).toBe(0);
  });
});
