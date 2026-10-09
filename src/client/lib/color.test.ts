import { describe, expect, test } from "bun:test";
import { debounce, hexToLch, lchToHex, maxChroma, normalizeHex } from "./color.ts";

describe("normalizeHex", () => {
  test("accepts 3 and 6 digit hex, with or without #", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("6d5bd0")).toBe("#6d5bd0");
    expect(normalizeHex("  #6D5BD0 ")).toBe("#6d5bd0");
  });

  test("rejects everything else", () => {
    for (const bad of ["", "#12", "#12345", "#1234567", "#ggg", "rgb(1,2,3)"]) expect(normalizeHex(bad)).toBeNull();
  });
});

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe("oklch conversion", () => {
  test("black, white and gray have no vibrance", () => {
    expect(lchToHex({ h: 0, v: 100, l: 0 })).toBe("#000000");
    expect(lchToHex({ h: 120, v: 100, l: 100 })).toBe("#ffffff");
    expect(hexToLch("#ffffff").v).toBe(0);
    expect(hexToLch("#808080").v).toBeLessThan(1);
    expect(lchToHex({ h: 40, v: 0, l: 50 })).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });

  test("gray keeps the hue it is given", () => {
    expect(hexToLch("#808080", 215).h).toBe(215);
  });

  test("matches known OKLCH values", () => {
    const red = hexToLch("#ff0000");
    expect(red.l).toBeCloseTo(62.8, 0);
    expect(red.h).toBeCloseTo(29.2, 0);
    expect(red.v).toBeCloseTo(100, 0);
  });

  test("every vibrance step stays inside sRGB", () => {
    for (let h = 0; h < 360; h += 30) {
      for (let l = 5; l <= 95; l += 15) {
        const max = maxChroma(l / 100, h);
        expect(max).toBeGreaterThan(0);
        const hex = lchToHex({ h, v: 100, l });
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  test("hex survives a round trip", () => {
    for (const hex of ["#6d5bd0", "#9fcaa8", "#e1b75c", "#2f5a43", "#a9342b", "#f7f8f6", "#141916", "#78c5d8", "#ff00ff"]) {
      const back = lchToHex(hexToLch(hex));
      const worst = Math.max(...channels(hex).map((c, i) => Math.abs(c - channels(back)[i]!)));
      expect(worst).toBeLessThanOrEqual(2);
    }
  });
});

describe("debounce", () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test("runs once with the latest value after the pushes stop", async () => {
    const seen: number[] = [];
    const d = debounce<number>((n) => seen.push(n), 30);
    for (let i = 1; i <= 10; i++) d.push(i);
    expect(seen).toEqual([]);
    await wait(70);
    expect(seen).toEqual([10]);
  });

  test("flush sends the waiting value at once and only once", async () => {
    const seen: number[] = [];
    const d = debounce<number>((n) => seen.push(n), 1000);
    d.push(1);
    d.push(2);
    d.flush();
    d.flush();
    expect(seen).toEqual([2]);
    await wait(20);
    expect(seen).toEqual([2]);
  });
});
