import { expect, test } from "bun:test";
import { parsePlanUsage } from "./plan.ts";

test("takes the latest sample, whichever account it is for", () => {
  const doc = {
    version: 2,
    samples: [
      { t: 100, org: "a", u: { fh: 44, sd: 59, xu: 37.36 } },
      { t: 300, org: "b", u: { fh: 20, sd: 3 } },
      { t: 200, org: "a", u: { fh: 47, sd: 60 } },
    ],
  };
  expect(parsePlanUsage(doc)).toEqual({ at: 300, fiveHour: 20, weekly: 3 });
});

test("keeps a limit the sample leaves out as null", () => {
  expect(parsePlanUsage({ samples: [{ t: 1, u: { sd: 12 } }] })).toEqual({ at: 1, fiveHour: null, weekly: 12 });
});

test("returns null for a missing, empty or unfamiliar file", () => {
  expect(parsePlanUsage(null)).toBeNull();
  expect(parsePlanUsage({ samples: [] })).toBeNull();
  expect(parsePlanUsage({ samples: [{ t: 1, u: { other: 5 } }] })).toBeNull();
  expect(parsePlanUsage({ version: 3, rows: [] })).toBeNull();
});
