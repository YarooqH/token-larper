import type { createSettings } from "./settings.ts";

/** What POST /api/privacy answers: a status code and a JSON body. */
export interface PrivacyReply {
  status: number;
  body: unknown;
}

/** Validates the request body and applies it; kept apart from the server so it can be tested. */
export function updatePrivacy(settings: ReturnType<typeof createSettings>, body: unknown): PrivacyReply {
  const offline = body && typeof body === "object" && !Array.isArray(body) ? (body as { offline?: unknown }).offline : undefined;
  if (typeof offline !== "boolean") return { status: 400, body: { error: "Expected { offline: boolean }" } };
  if (!offline && settings.status().locked) {
    return { status: 409, body: { error: "TOKEN_LARPER_OFFLINE is set, so offline mode can't be turned off here." } };
  }
  return { status: 200, body: settings.setOffline(offline) };
}
