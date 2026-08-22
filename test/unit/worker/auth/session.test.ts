import {
  type AuthContext,
  isRecentSession,
  isRecentSessionForEnvironment,
  recentSessionMaxAgeMs,
  requireRecentSession
} from "@worker/auth/session";
import { describe, expect, it } from "vitest";

const now = new Date("2026-07-28T12:00:00.000Z");

function authContext(createdAt: Date): AuthContext {
  return {
    session: {
      id: "session-1",
      userId: "user-1",
      createdAt
    },
    user: {
      id: "user-1",
      email: "owner@example.com",
      name: "Workspace Owner",
      role: "owner"
    }
  };
}

describe("recent authentication", () => {
  it("accepts a session at the recent-authentication boundary", () => {
    const auth = authContext(new Date(now.getTime() - 10 * 60 * 1000));

    expect(isRecentSession(auth, 10 * 60 * 1000, now.getTime())).toBe(true);
  });

  it("rejects a session after the recent-authentication window", () => {
    const auth = authContext(new Date(now.getTime() - 10 * 60 * 1000 - 1));

    expect(isRecentSession(auth, 10 * 60 * 1000, now.getTime())).toBe(false);
    expect(() => requireRecentSession(authContext(new Date(0)), 10 * 60 * 1000)).toThrow(
      "Sign in again before changing workspace infrastructure."
    );
  });

  it("accepts a deployment-configured window up to 24 hours", () => {
    const auth = authContext(new Date(now.getTime() - 23 * 60 * 60 * 1000));

    expect(
      isRecentSessionForEnvironment(auth, { RECENT_AUTH_MAX_AGE_SECONDS: "86400" }, now.getTime())
    ).toBe(true);
  });

  it.each([
    undefined,
    "",
    "299",
    "86401",
    "600.5",
    "not-a-number"
  ])("falls back to ten minutes for invalid deployment value %s", (configured) => {
    const env = configured === undefined ? {} : { RECENT_AUTH_MAX_AGE_SECONDS: configured };
    expect(recentSessionMaxAgeMs(env)).toBe(10 * 60 * 1000);
  });
});
