export type ReleaseManifest = {
  format: "sovereign-mail-release-v1";
  product: "sovereign-mail";
  channel: "stable";
  version: string;
  schemaVersion: number;
  minVersion: string;
  publishedAt: string;
  notesUrl: string;
  artifact: { url: string; sha256: string; size: number };
  keyId: string;
};

export type UpdateCompatibilityIssue = {
  code: "release-state-mismatch" | "schema-downgrade" | "minimum-version";
  message: string;
};

export type UpdateStatus = {
  product: "sovereign-mail";
  runningVersion: string | null;
  installedVersion: string;
  installedSchemaVersion: number;
  channel: "stable";
  checkedAt: string;
  available: boolean;
  compatible: boolean;
  compatibilityIssue: UpdateCompatibilityIssue | null;
  release: ReleaseManifest;
};
