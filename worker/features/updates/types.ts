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

export type UpdateStatus = {
  product: "sovereign-mail";
  installedVersion: string;
  installedSchemaVersion: number;
  channel: "stable";
  checkedAt: string;
  available: boolean;
  compatible: boolean;
  release: ReleaseManifest;
};
