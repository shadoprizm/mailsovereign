import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAIAAAC6iKlyAAABKklEQVR4nO3Q5zoCABgF4C7H3nvPY++9d/bdkUgkEolEIpFI9+E7d+HHeZ73Cl5HDg5MLh3mkSsfrgI6KiR3EdzFODYldFJKnjJ4yum0gryV8FbhzFTTeQ35auGro4t68jfA34hL00RXzRRoQaCVrtso2I5gB25MJ92CQl0IddNdD4V7Ee7DvemnhwGKDCIyRI/DFB1BdBRPZoyexyk2gdgkvUxRfBrxGbyaWXqbo8Q8Egv0vkjJJSSX8WFW6HOVUmtIrdPXBqWdSG/i22zRzzZldpDZpd89yu4j61C0ohWtaEUrWtGKVrSiFa1oRSta0YpWtKIVrWhFK1rRila0ohWtaEUrWtGKVrSiFa1oRSta0YpWtKIVrWhFK1rRila0ohWtaEUr+v9F/wEj2Yloyuh4VwAAAABJRU5ErkJggg==",
  "base64"
);
export const imageHost = "https://images.sovereign-mail.invalid";

export function imageFixtures(config: string, origin: string, mailboxId: string) {
  const directory = path.dirname(path.resolve(config));
  const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
  if (
    !/^(?:images-e2e|e2e-\d+)$/.test(manifest.name) ||
    !manifest.d1.created ||
    !manifest.r2.created ||
    ![`${manifest.worker.name}.sovereignmail.workers.dev`, manifest.appDomain].includes(
      new URL(origin).hostname
    )
  )
    throw new Error("Image fixtures require a manifest-backed disposable staging deployment.");
  const prefix = `images_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const ids = [`${prefix}_one`, `${prefix}_two`, `${prefix}_other`];
  const sender = `${prefix}@example.com`;
  const timestamp = new Date().toISOString();
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  function wrangler(args: string[]) {
    execFileSync("pnpm", ["exec", "wrangler", ...args, "--config", config], {
      stdio: "pipe",
      timeout: 90_000
    });
  }
  function sql(statements: string[]) {
    const file = path.join(directory, `${prefix}.sql`);
    writeFileSync(file, statements.join("\n"), { mode: 0o600 });
    wrangler(["d1", "execute", "DB", "--remote", "--file", file, "--yes"]);
  }
  const objects: string[] = [];
  function put(key: string, value: string | Buffer, type: string) {
    objects.push(key);
    const file = path.join(directory, `${prefix}.fixture`);
    writeFileSync(file, value);
    wrangler([
      "r2",
      "object",
      "put",
      `${manifest.r2.bucket}/${key}`,
      "--remote",
      "--file",
      file,
      "--content-type",
      type
    ]);
  }
  return {
    ids,
    prefix,
    async seed() {
      const html = `<style>.image-banner { background-image:url('${imageHost}/sheet.png'); height:32px; }</style>
        <h2>Synthetic image verification</h2><table><tr><td>Project</td><td>Deployment</td></tr><tr><td><img alt="Remote badge" src="${imageHost}/badge.png" width="100" height="32"></td><td>Ready</td></tr></table>
        <p><img alt="Embedded logo" src="cid:logo@example.com" width="32" height="32"> <img alt="Embedded data" src="data:image/png;base64,${pixel.toString("base64")}" width="32" height="32"></p>
        <p><img alt="Responsive image" srcset="${imageHost}/responsive.png 1x, ${imageHost}/responsive2.png 2x" width="64" height="32"></p>
        <picture><source media="(min-width: 1px)" srcset="${imageHost}/picture.png 1x"><img alt="Picture image" src="${imageHost}/fallback.png" width="64" height="32"></picture>
        <div class="image-banner">Stylesheet background</div><div style="background:url('${imageHost}/inline.png') center / cover no-repeat;height:32px">Inline background</div>
        <table background="${imageHost}/table.png" height="32"><tr><td>Table background</td></tr></table>
        <p><img alt="Slow image" src="${imageHost}/slow.png" width="64" height="32"></p>
        <p><img alt="Retry image" src="${imageHost}/retry.png" width="64" height="32"></p>
        <p><img alt="Real GitHub image" src="https://avatars.githubusercontent.com/u/9919?s=64" width="64" height="64"></p>
        <div class="gmail_quote"><img alt="Quoted image" src="${imageHost}/quote.png" width="32" height="32"></div>`;
      const statements: string[] = [];
      const key = `${prefix}/body.html`;
      put(key, html, "text/html");
      put(`${prefix}/logo.png`, pixel, "image/png");
      for (const [index, id] of ids.entries()) {
        const subject = `Re: ${prefix} ${index}`;
        statements.push(
          `INSERT INTO threads (id, subject_normalized, last_message_at, created_at, updated_at) VALUES ('${id}', ${quote(subject)}, '${timestamp}', '${timestamp}', '${timestamp}');`,
          `INSERT INTO messages (id, thread_id, mailbox_id, direction, folder, from_address, to_json, cc_json, bcc_json, subject, snippet, text_body, html_r2_key, references_json, received_at, created_at, updated_at) VALUES ('${id}', '${id}', ${quote(mailboxId)}, 'inbound', 'inbox', ${quote(index === 2 ? `other_${sender}` : sender)}, '[]', '[]', '[]', ${quote(subject)}, 'Synthetic image verification', 'Synthetic image verification', ${quote(key)}, '[]', '${timestamp}', '${timestamp}', '${timestamp}');`,
          `INSERT INTO message_attachments (id, message_id, filename, content_type, size_bytes, content_id, r2_key, created_at) VALUES ('${id}_logo', '${id}', 'logo.png', 'image/png', ${pixel.length}, 'logo@example.com', '${prefix}/logo.png', '${timestamp}');`
        );
      }
      sql(statements);
    },
    cleanup() {
      sql([
        `DELETE FROM message_sender_preferences WHERE sender_address IN (${quote(sender)}, ${quote(`other_${sender}`)});`,
        `DELETE FROM messages WHERE id IN (${ids.map(quote).join(",")});`,
        `DELETE FROM threads WHERE id IN (${ids.map(quote).join(",")});`
      ]);
      for (const key of objects)
        wrangler(["r2", "object", "delete", `${manifest.r2.bucket}/${key}`, "--remote"]);
    }
  };
}
