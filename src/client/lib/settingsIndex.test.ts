import { describe, expect, test } from "bun:test";
import { groupBySection, searchSettings, SETTING_ENTRIES, SETTINGS_SECTIONS } from "./settingsIndex.ts";
import { isEditable } from "./shortcuts.ts";

const ids = (query: string) => searchSettings(query).map((e) => e.id);

describe("settings search", () => {
  test("an empty query lists every setting in panel order", () => {
    expect(searchSettings("")).toEqual([...SETTING_ENTRIES]);
    expect(searchSettings("   ")).toEqual([...SETTING_ENTRIES]);
  });

  test("finds a setting by a word that is only in its keywords", () => {
    expect(ids("dark")).toEqual(["mode"]);
    expect(ids("streak")).toEqual(["stats"]);
    expect(ids("tweakcn")).toEqual(["import"]);
    expect(ids("port")).toEqual(["details"]);
    expect(ids("redact")).toEqual(["screenshot"]);
    expect(ids("airplane")).toEqual(["offline"]);
  });

  test("matches word prefixes, ignoring case", () => {
    expect(ids("COL")).toEqual(["mode", "base", "accent", "import"]);
    expect(ids("sign-in")).toEqual(["autostart", "browser"]);
  });

  test("every word typed has to match", () => {
    expect(ids("accent color")).toEqual(["accent"]);
    expect(ids("accent startup")).toEqual([]);
  });

  test("the section name finds everything in that section", () => {
    expect(ids("about")).toEqual(["updates", "details"]);
    expect(ids("privacy")).toEqual(["screenshot", "offline", "auto-check", "price-list"]);
  });

  test("a network search finds every setting that makes a request", () => {
    expect(ids("network")).toEqual(["offline", "auto-check", "price-list"]);
  });

  test("gives nothing for text that matches no setting", () => {
    expect(ids("xyzzy")).toEqual([]);
  });

  test("groups matches by section, in section order, without empty sections", () => {
    const groups = groupBySection(searchSettings("startup"));
    expect(groups.map((g) => g.section.id)).toEqual(["general"]);
    expect([...groups[0]!.ids]).toEqual(["autostart", "browser"]);
  });

  test("every setting belongs to a listed section and has a unique id", () => {
    const sections = new Set(SETTINGS_SECTIONS.map((s) => s.id));
    expect(SETTING_ENTRIES.every((e) => sections.has(e.section))).toBe(true);
    expect(new Set(SETTING_ENTRIES.map((e) => e.id)).size).toBe(SETTING_ENTRIES.length);
  });
});

describe("shortcut targets", () => {
  const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;

  test("text fields and selects keep their keystrokes", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) expect(isEditable(el(tag))).toBe(true);
    expect(isEditable(el("DIV", true))).toBe(true);
  });

  test("buttons, the page, and no target leave shortcuts on", () => {
    expect(isEditable(el("BUTTON"))).toBe(false);
    expect(isEditable(el("BODY"))).toBe(false);
    expect(isEditable(null)).toBe(false);
    expect(isEditable({} as EventTarget)).toBe(false);
  });
});
