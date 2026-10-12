/**
 * Credential references are device/vault-local. Synchrun may sync the plugin's
 * data.json, but Obsidian SecretStorage is never synced with it.
 */
export interface CredentialRefs {
  apiKeySecretId: string;
  accessClientIdSecretId: string;
  accessClientSecretSecretId: string;
}

export type CredentialField = keyof CredentialRefs;
type LocalStore = {
  loadLocalStorage(key: string): unknown | null;
  saveLocalStorage(key: string, data: unknown | null): void;
};
type SecretReader = {
  getSecret(id: string): string | null;
  listSecrets(): string[];
};

const STORE_KEY = 'wallos-companion:local-credentials:v1';
const fields: readonly CredentialField[] = [
  'apiKeySecretId', 'accessClientIdSecretId', 'accessClientSecretSecretId',
];
const empty = (): CredentialRefs => ({
  apiKeySecretId: '',
  accessClientIdSecretId: '',
  accessClientSecretSecretId: '',
});

function stringId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Only the first load can migrate old synced references. Once a local record
 * exists, even an explicit logout must not resurrect a credential.
 */
export function loadLocalCredentials(
  app: LocalStore, secrets: SecretReader, legacy: Partial<CredentialRefs> = {},
): CredentialRefs {
  const local = app.loadLocalStorage(STORE_KEY);
  if (local && typeof local === 'object' && !Array.isArray(local)
      && (local as Record<string, unknown>).version === 1) {
    const row = local as Record<string, unknown>;
    const refs = empty();
    for (const field of fields) refs[field] = stringId(row[field]);
    return refs;
  }

  const refs = empty();
  for (const field of fields) {
    const candidate = stringId(legacy[field]);
    if (candidate && secrets.getSecret(candidate)) refs[field] = candidate;
  }

  // A synced legacy data.json may point to *another* device's UUID.
  // Recover the only matching local legacy secret if it is unambiguous.
  if (!refs.apiKeySecretId) {
    const candidates = secrets.listSecrets().filter((id) =>
      /^wallos-companion-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
      && Boolean(secrets.getSecret(id)));
    if (candidates.length === 1) refs.apiKeySecretId = candidates[0];
  }

  persistLocalCredentials(app, refs);
  return refs;
}

export function persistLocalCredentials(app: LocalStore, refs: CredentialRefs): void {
  app.saveLocalStorage(STORE_KEY, { version: 1, ...refs });
}

/** Drop credential pointers before writing settings into a syncable Vault. */
export function omitCredentialsFromSettings<T extends object>(
  input: T & Partial<CredentialRefs>,
): Omit<T, CredentialField> {
  const { apiKeySecretId: _api, accessClientIdSecretId: _accessId,
    accessClientSecretSecretId: _accessSecret, ...settings } = input;
  return settings as Omit<T, CredentialField>;
}
