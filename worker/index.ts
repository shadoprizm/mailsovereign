import { handleInboundEmail } from "./email/inbound";
import { handleMcpRoute } from "./features/mcp/route";
import { notifyInboundMessage } from "./features/notifications/delivery";
import { consumeJobs } from "./jobs/consumer";
import type { WorkerEnv } from "./lib/env";
import { requireCapability } from "./providers/capabilities";
import { cloudflareConnection } from "./providers/cloudflare/connection";
import { toInboundEmailEvent } from "./providers/cloudflare/inbound";
import { listImapSmtpConnections } from "./providers/connections";
import { apiRoutes } from "./routes";

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const mcpResponse = await handleMcpRoute(request, env, ctx);
    if (mcpResponse) return withSecurityHeaders(mcpResponse, request);
    if (url.pathname.startsWith("/api/")) {
      return withSecurityHeaders(await apiRoutes.fetch(request, env, ctx), request);
    }

    const portal = request.headers.get("accept")?.includes("text/html")
      ? await env.DB.prepare(
          `SELECT current.is_canonical, canonical.hostname AS canonical_hostname
       FROM workspace_hosts current
       JOIN workspace_hosts canonical ON canonical.kind = 'portal' AND canonical.is_canonical = 1
       WHERE current.kind = 'portal' AND current.hostname = ?`
        )
          .bind(url.hostname.toLowerCase())
          .first<{ is_canonical: number; canonical_hostname: string }>()
          .catch(() => null)
      : null;
    if (portal && portal.is_canonical !== 1) {
      url.hostname = portal.canonical_hostname;
      return withSecurityHeaders(Response.redirect(url.toString(), 308), request);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request), request);
  },

  async email(
    message: ForwardableEmailMessage,
    env: WorkerEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    requireCapability(cloudflareConnection, "receive");
    const stored = await handleInboundEmail(env, await toInboundEmailEvent(message));
    if (stored.inserted) {
      ctx.waitUntil(
        notifyInboundMessage(env, stored.message).catch(() => {
          // Push delivery is additive and never changes accepted inbound mail.
        })
      );
    }
  },

  async scheduled(controller: ScheduledController, env: WorkerEnv): Promise<void> {
    if (!env.SOVEREIGN_MAIL_JOBS) throw new Error("SOVEREIGN_MAIL_JOBS binding is required.");
    const requestedAt = new Date().toISOString();
    if (controller.cron === "*/5 * * * *") {
      const connections = await listImapSmtpConnections(env.DB);
      for (const connection of connections) {
        if (!connection.isEnabled || !connection.verifiedAt || !connection.mailboxAddress) continue;
        await env.SOVEREIGN_MAIL_JOBS.send({
          id: `provider-sync:${connection.providerId}:${requestedAt.slice(0, 16)}`,
          kind: "provider-sync",
          providerId: connection.providerId,
          requestedAt
        });
      }
      return;
    }
    await env.SOVEREIGN_MAIL_JOBS.send({
      id: `maintenance:${requestedAt.slice(0, 10)}`,
      kind: "maintenance",
      requestedAt
    });
    await env.SOVEREIGN_MAIL_JOBS.send({
      id: `integrity:${requestedAt.slice(0, 10)}`,
      kind: "integrity-scan",
      requestedAt
    });
  },

  async queue(batch: MessageBatch<import("./jobs/types").Job>, env: WorkerEnv): Promise<void> {
    await consumeJobs(batch, env);
  }
};

function withSecurityHeaders(response: Response, request: Request): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("content-security-policy", securityPolicy);
  secured.headers.set("cross-origin-opener-policy", "same-origin");
  secured.headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  secured.headers.set("referrer-policy", "no-referrer");
  secured.headers.set("x-content-type-options", "nosniff");
  secured.headers.set("x-frame-options", "DENY");
  if (new URL(request.url).protocol === "https:") {
    secured.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return secured;
}

const securityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:"
].join("; ");
