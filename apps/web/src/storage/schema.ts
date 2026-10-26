/** Version of the OPFS layout and of every JSON file this build writes. */
export const STORAGE_SCHEMA_VERSION = 1;

/** A file written by a newer MDLeaf is opened read-only. */
export function isNewerSchema(record: { schemaVersion: number }): boolean {
  return record.schemaVersion > STORAGE_SCHEMA_VERSION;
}
