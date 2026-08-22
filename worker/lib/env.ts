import type { AuthContext } from "../auth/session";

type WorkerEnvOverrides = {
  AI?: Ai;
  CLOUDFLARE_OAUTH_MODE?: string;
  CLOUDFLARE_OAUTH_CLIENT_ID?: string;
  BETTER_AUTH_URL?: string;
  ENVIRONMENT?: string;
  SOVEREIGN_MAIL_WORKER_NAME?: string;
  SOVEREIGN_MAIL_APP_VERSION?: string;
  SOVEREIGN_MAIL_RELEASE_MANIFEST_URL?: string;
  SOVEREIGN_MAIL_RELEASE_PUBLIC_KEY?: string;
  SOVEREIGN_MAIL_UPDATES_ENABLED?: string;
  SOVEREIGN_MAIL_INSTALLATION_ID?: string;
  SOVEREIGN_MAIL_JOBS?: Queue;
  PROVIDER_CREDENTIAL_KEY?: string;
  RECENT_AUTH_MAX_AGE_SECONDS?: string;
  STRIPE_AI_PRO_PRICE_ID?: string;
  STRIPE_AI_STARTER_PRICE_ID?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_SUBJECT?: string;
};

export type WorkerEnv = Omit<Cloudflare.Env, keyof WorkerEnvOverrides> & WorkerEnvOverrides;

export type HonoApp = {
  Bindings: WorkerEnv;
  Variables: {
    auth: AuthContext;
    correlationId: string;
  };
};
