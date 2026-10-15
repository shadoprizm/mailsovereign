import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("native mail device setup and TLS gateway use the deployed staging Worker", async ({
  page,
  request
}) => {
  const manifestPath = process.env.SOVEREIGN_MAIL_NATIVE_STAGING_MANIFEST;
  test.skip(!manifestPath, "A disposable native-mail staging manifest is required.");
  const manifest = JSON.parse(readFileSync(resolve(manifestPath as string), "utf8")) as {
    name: string;
    authUrl: string;
    nativeMail?: { host: string };
  };
  const origin = process.env.SOVEREIGN_MAIL_STAGING_URL ?? "";
  expect(manifest.authUrl).toBe(origin);
  expect(manifest.name).toMatch(/(?:^|-)e2e(?:-|$)/);
  expect(manifest.nativeMail?.host).toBe("native-e2e.invalid");
  const ownerEmail = process.env.SOVEREIGN_MAIL_STAGING_OWNER_EMAIL;
  const ownerPassword = process.env.SOVEREIGN_MAIL_STAGING_OWNER_PASSWORD;
  if (!ownerEmail || !ownerPassword) throw new Error("Staging owner credentials are required.");
  const login = await request.post("/api/auth/sign-in/email", {
    data: { email: ownerEmail, password: ownerPassword },
    headers: { origin }
  });
  expect(login.ok()).toBe(true);
  const mailboxResponse = await request.get("/api/mailboxes");
  expect(mailboxResponse.ok()).toBe(true);
  const mailboxes = (await mailboxResponse.json()) as Array<{ id: string; address: string }>;
  const primary = mailboxes[0];
  if (!primary) throw new Error("The disposable installation has no test mailbox.");
  const address = `native-${Date.now()}@${primary.address.split("@")[1]}`;
  const created = await request.post("/api/mailboxes", {
    data: { address, displayName: "Native protocol staging" }
  });
  expect(created.status()).toBe(201);
  const mailbox = (await created.json()) as { id: string };
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto("/settings/mailboxes");
  const section = page.getByRole("region", { name: "Apple Mail and other mail apps" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("option", { name: address, exact: true })).toBeAttached();
  await section.getByLabel("Mailbox", { exact: true }).selectOption(mailbox.id);
  await section.getByLabel("Device name").fill("Staging iPhone");
  await section.getByRole("button", { name: "Create device password" }).click();
  const passwordInput = section.getByLabel("Device password", { exact: true });
  await expect(passwordInput).toBeVisible();
  const password = await passwordInput.inputValue();
  if (!/^[A-Za-z0-9_-]{43}$/.test(password)) throw new Error("A device password was not returned.");
  const settings = (await (await request.get("/api/native-mail/settings")).json()) as {
    passwords: Array<{ id: string; label: string; mailboxId: string }>;
  };
  const credential = settings.passwords.find(
    (item) => item.mailboxId === mailbox.id && item.label === "Staging iPhone"
  );
  if (!credential) throw new Error("The test device password was not recorded.");
  const child = spawn(process.execPath, ["gateway/test/staging-driver.mjs"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  });
  let revoked = false,
    completed = false,
    output = "";
  let revocation: Promise<void> = Promise.resolve();
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes('"phase":"revoke"') && !revoked) {
      revoked = true;
      revocation = request
        .delete(`/api/native-mail/passwords/${credential.id}`)
        .then((response) => {
          if (response.status() !== 204) throw new Error("The test device could not be revoked.");
        });
    }
    if (output.includes('"phase":"complete"')) completed = true;
  });
  // Errors stay generic: the child never logs protocol exchanges or credentials.
  child.stderr.on("data", () => {});
  const extraHeaders: Record<string, string> = {};
  if (
    process.env.SOVEREIGN_MAIL_STAGING_ACCESS_CLIENT_ID &&
    process.env.SOVEREIGN_MAIL_STAGING_ACCESS_CLIENT_SECRET
  ) {
    extraHeaders["CF-Access-Client-Id"] = process.env.SOVEREIGN_MAIL_STAGING_ACCESS_CLIENT_ID;
    extraHeaders["CF-Access-Client-Secret"] =
      process.env.SOVEREIGN_MAIL_STAGING_ACCESS_CLIENT_SECRET;
  }
  child.stdin.end(JSON.stringify({ origin, address, password, extraHeaders }));
  try {
    const code = await new Promise<number | null>((resolveExit, reject) => {
      child.once("exit", resolveExit);
      child.once("error", reject);
    });
    await revocation;
    expect(code, "TLS protocol verification against the staging Worker").toBe(0);
    expect(completed).toBe(true);
    expect(revoked).toBe(true);
  } finally {
    child.kill("SIGTERM");
    await request.delete(`/api/native-mail/passwords/${credential.id}`);
    await request.patch(`/api/mailboxes/${mailbox.id}`, { data: { isActive: false } });
  }
});
