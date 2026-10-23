import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrations = readdirSync("migrations")
  .filter((name) => name.endsWith(".sql") && name <= "0026_ai_provider_connection.sql")
  .sort();
const apply = (db: DatabaseSync, files: string[]) => {
  for (const file of files) db.exec(readFileSync(`migrations/${file}`, "utf8"));
};

describe("AI provider migration", () => {
  it("supports fresh installs and preserves existing billing and writing profiles on upgrade", () => {
    for (const upgrade of [false, true]) {
      const db = new DatabaseSync(":memory:");
      apply(db, upgrade ? migrations.slice(0, -1) : migrations);
      if (upgrade) {
        db.exec("UPDATE ai_subscription SET status = 'active', plan_id = 'pro'");
        apply(db, migrations.slice(-1));
        expect(db.prepare("SELECT status FROM ai_subscription").get()).toEqual({
          status: "active"
        });
      }
      expect(db.prepare("SELECT * FROM ai_provider_connection").all()).toEqual([]);
      expect(db.prepare("SELECT installed_schema_version FROM release_state").get()).toEqual({
        installed_schema_version: 26
      });
      db.exec(
        "INSERT INTO ai_provider_connection VALUES (1, 'https://example.com/v1', 'fast', 'quality', 'encrypted', 'now')"
      );
      expect(() =>
        db.exec("INSERT INTO ai_provider_connection VALUES (2, '', '', '', '', '')")
      ).toThrow();
      db.close();
    }
  });
});
