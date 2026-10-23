import assert from "node:assert/strict";
import { test } from "node:test";
import { gatewayConfig, gatewayTls } from "../src/config.mjs";

test("split gateways reject invalid protocols and listener ports", () => {
  assert.equal(gatewayConfig({ SOVEREIGN_MAIL_PROTOCOL: "smtp" }).protocol, "smtp");
  assert.equal(gatewayConfig({ SOVEREIGN_MAIL_PROTOCOL: "imap" }).protocol, "imap");
  assert.throws(() => gatewayConfig({ SOVEREIGN_MAIL_PROTOCOL: "plain" }), /protocol/);
  for (const value of ["0", "65536", "1.5", "NaN"])
    assert.throws(() => gatewayConfig({ SOVEREIGN_MAIL_IMAP_PORT: value }), /port/);
});

test("TLS remains mandatory and a partial secret pair fails closed", async () => {
  await assert.rejects(gatewayTls({}), /certificate/);
  await assert.rejects(gatewayTls({ SOVEREIGN_MAIL_TLS_CERT_PEM: "certificate" }), /Both/);
  assert.deepEqual(
    await gatewayTls({
      SOVEREIGN_MAIL_TLS_CERT_PEM: "certificate",
      SOVEREIGN_MAIL_TLS_KEY_PEM: "key"
    }),
    { cert: "certificate", key: "key" }
  );
});
