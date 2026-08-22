import { z } from "zod";

import type { WorkerEnv } from "../lib/env";
import { AppError } from "../lib/errors";
import type { WorkspaceRole } from "../lib/validation";
import { parseWith, workspaceRoleSchema } from "../lib/validation";

import { createAuth } from "./auth";
import { isPasswordSetupRequired } from "./password-setup";

const betterSessionSchema = z.object({
  session: z.object({
    id: z.string(),
    userId: z.string(),
    createdAt: z.coerce.date()
  }),
  user: z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: workspaceRoleSchema.optional().nullable()
  })
});

const defaultRecentSessionMaxAgeMs = 10 * 60 * 1000;
const minimumRecentSessionMaxAgeSeconds = 5 * 60;
const maximumRecentSessionMaxAgeSeconds = 24 * 60 * 60;

export type AuthContext = {
  session: {
    id: string;
    userId: string;
    createdAt: Date;
  };
  user: {
    id: string;
    email: string;
    name: string;
    role: WorkspaceRole;
  };
};

export async function getAuthContext(
  env: WorkerEnv,
  request: Request
): Promise<AuthContext | null> {
  const auth = createAuth(env, request);
  const rawSession = await auth.api.getSession({
    headers: request.headers
  });

  if (!rawSession) {
    return null;
  }

  const parsed = parseWith(betterSessionSchema, rawSession);
  return {
    session: parsed.session,
    user: {
      id: parsed.user.id,
      email: parsed.user.email,
      name: parsed.user.name,
      role: parsed.user.role ?? "member"
    }
  };
}

export async function requireAuthContext(
  env: WorkerEnv,
  request: Request,
  options: { allowPasswordSetupRequired?: boolean } = {}
): Promise<AuthContext> {
  const authContext = await getAuthContext(env, request);
  if (!authContext) {
    throw new AppError("UNAUTHENTICATED", "Sign in is required.", 401);
  }
  if (
    !options.allowPasswordSetupRequired &&
    (await isPasswordSetupRequired(env.DB, authContext.user.id))
  ) {
    throw new AppError(
      "PASSWORD_SETUP_REQUIRED",
      "Replace your temporary password before using this workspace.",
      403
    );
  }
  return authContext;
}

export function requireRole(
  authContext: AuthContext,
  allowed: readonly WorkspaceRole[],
  message = "You do not have permission to perform this action."
): void {
  if (!allowed.includes(authContext.user.role)) {
    throw new AppError("FORBIDDEN", message, 403);
  }
}

export function requireRecentSession(
  authContext: AuthContext,
  maxAgeMs = defaultRecentSessionMaxAgeMs
): void {
  if (!isRecentSession(authContext, maxAgeMs)) {
    throw new AppError(
      "RECENT_AUTH_REQUIRED",
      "Sign in again before changing workspace infrastructure.",
      403
    );
  }
}

export function requireRecentSessionForEnvironment(
  authContext: AuthContext,
  env: Pick<WorkerEnv, "RECENT_AUTH_MAX_AGE_SECONDS">
): void {
  requireRecentSession(authContext, recentSessionMaxAgeMs(env));
}

export function isRecentSession(
  authContext: AuthContext,
  maxAgeMs = defaultRecentSessionMaxAgeMs,
  now = Date.now()
): boolean {
  return now - authContext.session.createdAt.getTime() <= maxAgeMs;
}

export function isRecentSessionForEnvironment(
  authContext: AuthContext,
  env: Pick<WorkerEnv, "RECENT_AUTH_MAX_AGE_SECONDS">,
  now = Date.now()
): boolean {
  return isRecentSession(authContext, recentSessionMaxAgeMs(env), now);
}

export function recentSessionMaxAgeMs(env: Pick<WorkerEnv, "RECENT_AUTH_MAX_AGE_SECONDS">): number {
  const configured = env.RECENT_AUTH_MAX_AGE_SECONDS;
  if (!configured || !/^\d+$/.test(configured)) return defaultRecentSessionMaxAgeMs;
  const seconds = Number(configured);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < minimumRecentSessionMaxAgeSeconds ||
    seconds > maximumRecentSessionMaxAgeSeconds
  ) {
    return defaultRecentSessionMaxAgeMs;
  }
  return seconds * 1000;
}
