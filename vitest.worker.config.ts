import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      "assert",
      "buffer",
      "crypto",
      "http",
      "https",
      "net",
      "stream",
      "tls",
      "url",
      "util"
    ].map((module) => ({ find: new RegExp(`^${module}$`), replacement: `node:${module}` }))
  },
  plugins: [
    cloudflareTest({
      wrangler: {
        // Workers AI is a remote-only binding. Integration tests use an explicit config without
        // that binding and exercise inference through unit-level fakes instead.
        configPath: "./wrangler.test.jsonc"
      },
      miniflare: {
        bindings: {
          BETTER_AUTH_SECRET: "integration-auth-secret-A7x9Q2m4V8p6L1s3",
          SOVEREIGN_MAIL_INSTALLATION_ID: "installation_test",
          STRIPE_AI_PRO_PRICE_ID: "price_test_ai_pro",
          STRIPE_AI_STARTER_PRICE_ID: "price_test_ai_starter",
          STRIPE_SECRET_KEY: "sk_test_sovereign_mail",
          STRIPE_WEBHOOK_SECRET: "whsec_integration_test",
          VAPID_PRIVATE_KEY: "integration-vapid-private-key",
          VAPID_PUBLIC_KEY: "integration-vapid-public-key"
        },
        serviceBindings: {
          ASSETS: async () => new Response("Not found", { status: 404 })
        }
      }
    })
  ],
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: [
            "@modelcontextprotocol/sdk > ajv",
            "@modelcontextprotocol/sdk > ajv-formats",
            "sanitize-html",
            "web-push"
          ],
          esbuildOptions: {
            plugins: [
              {
                name: "externalize-node-builtins",
                setup(build) {
                  build.onResolve(
                    {
                      filter:
                        /^(?:node:)?(?:assert|buffer|crypto|http|https|net|stream|tls|url|util)$/
                    },
                    ({ path }) => ({
                      external: true,
                      path: path.startsWith("node:") ? path : `node:${path}`
                    })
                  );
                }
              }
            ]
          }
        }
      }
    },
    include: ["test/integration/worker/**/*.test.ts"]
  }
});
