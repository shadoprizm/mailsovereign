export type UpdateStatus = {
  product: "sovereign-mail";
  runningVersion: string | null;
  installedVersion: string;
  installedSchemaVersion: number;
  channel: "stable";
  checkedAt: string;
  available: boolean;
  compatible: boolean;
  compatibilityIssue: {
    code: "release-state-mismatch" | "schema-downgrade" | "minimum-version";
    message: string;
  } | null;
  release: {
    version: string;
    schemaVersion: number;
    publishedAt: string;
    notesUrl: string;
  };
};
