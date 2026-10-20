import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PrivacySettings } from "./PrivacySettings.tsx";
import { UpdateSettings } from "./UpdateSettings.tsx";
import type { Updates } from "../lib/updates.ts";
import type { PricingStatus } from "../../types.ts";

const noop = () => {};
const priceStatus: PricingStatus = { fetchedAt: new Date(Date.now() - 6 * 3_600_000).toISOString(), models: 300, lastDownloadFailed: false, offline: false };

const render = (over: Partial<Parameters<typeof PrivacySettings>[0]> = {}) =>
  renderToStaticMarkup(
    <PrivacySettings
      screenshot={false}
      onScreenshotChange={noop}
      privacy={{ status: { offline: false, locked: false }, saving: false, error: null }}
      onOfflineChange={noop}
      autoCheck
      onAutoCheckChange={noop}
      checkedAt={undefined}
      priceStatus={priceStatus}
      show={() => true}
      {...over}
    />
  );

const switchOf = (html: string, labelId: string) => html.match(new RegExp(`<button[^>]*aria-labelledby="${labelId}"[^>]*>`))?.[0] ?? "";

describe("privacy settings", () => {
  test("screenshot mode is a labelled switch that reflects the setting", () => {
    expect(switchOf(render(), "setting-screenshot-label")).toContain('aria-checked="false"');
    expect(switchOf(render({ screenshot: true }), "setting-screenshot-label")).toContain('aria-checked="true"');
  });

  test("offline mode pauses both requests and locks the update switch", () => {
    const html = render({ privacy: { status: { offline: true, locked: false }, saving: false, error: null } });
    expect(switchOf(html, "setting-offline-label")).toContain('aria-checked="true"');
    expect(switchOf(html, "setting-autoupdate-label")).toContain("disabled");
    expect(html).toContain("Paused · saved 6 h ago");
    expect(html).toContain(">Paused<");
  });

  test("offline mode names every outside request it stops, including plan quotas", () => {
    const html = render();
    expect(html).toContain("contact npm, OpenRouter, or the AI vendors.");
    expect(html).toContain("Limits shows only what local logs know");
  });

  test("plan quota lookups have their own row that says when they're paused", () => {
    const online = render({ show: (id) => id === "quota-lookups" });
    expect(online).toContain("Plan quota lookups");
    expect(online).toContain("Anthropic, OpenAI, GitHub, and Google");
    expect(online).toContain('<p class="setting-meta">On</p>');
    expect(online).toContain("Network");
    const offline = render({ show: (id) => id === "quota-lookups", privacy: { status: { offline: true, locked: false }, saving: false, error: null } });
    expect(offline).toContain('<p class="setting-meta">Paused</p>');
  });

  test("online, it says when each request last ran", () => {
    const html = render({ checkedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() });
    expect(html).toContain("Checked 2 h ago");
    expect(html).toContain("Updated 6 h ago");
    expect(switchOf(html, "setting-offline-label")).not.toContain("disabled");
  });

  test("an environment variable that forces offline mode cannot be switched off here", () => {
    const html = render({ privacy: { status: { offline: true, locked: true }, saving: false, error: null } });
    expect(switchOf(html, "setting-offline-label")).toContain("disabled");
    expect(html).toContain("TOKEN_LARPER_OFFLINE");
  });

  test("the offline switch waits for the server, and shows a failure", () => {
    expect(switchOf(render({ privacy: { status: null, saving: false, error: null } }), "setting-offline-label")).toContain("disabled");
    expect(switchOf(render({ privacy: { status: { offline: false, locked: false }, saving: true, error: null } }), "setting-offline-label")).toContain("disabled");
    const failed = render({ privacy: { status: { offline: false, locked: false }, saving: false, error: "HTTP 500" } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("HTTP 500");
  });

  test("renders only the settings asked for", () => {
    const html = render({ show: (id) => id === "price-list" });
    expect(html).toContain("Price list download");
    expect(html).not.toContain("Screenshot mode");
    expect(html).not.toContain("Offline mode");
  });
});

describe("update settings offline", () => {
  const updates: Updates = {
    status: { current: "1.20.0", latest: "1.21.0", updateAvailable: true, checkedAt: null, source: "npm" },
    checking: false,
    phase: "idle",
    error: null,
    check: async () => {},
    update: async () => {},
  };

  test("offers Update now while online", () => {
    expect(renderToStaticMarkup(<UpdateSettings updates={updates} offline={false} />)).toContain("Update now");
  });

  test("offline, it offers no update and no check, and says why", () => {
    const html = renderToStaticMarkup(<UpdateSettings updates={updates} offline />);
    expect(html).not.toContain("Update now");
    expect(html).toContain("Offline mode is on");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Check for updates/);
  });
});
