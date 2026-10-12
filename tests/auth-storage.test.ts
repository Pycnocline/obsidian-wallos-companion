import { describe, expect, it } from 'vitest';
import { loadLocalCredentials, omitCredentialsFromSettings, persistLocalCredentials } from '../src/auth-storage';

function fixture(entries: Record<string, string> = {}) {
  const local = new Map<string, unknown>();
  const secrets = new Map(Object.entries(entries));
  const app = {
    loadLocalStorage: (id: string) => local.get(id) ?? null,
    saveLocalStorage: (id: string, value: unknown | null) => { local.set(id, value); },
  };
  const secretStore = {
    getSecret: (id: string) => secrets.get(id) ?? null,
    listSecrets: () => [...secrets.keys()],
  };
  return { local, secrets, app, secretStore };
}

const ownId = 'wallos-companion-064b86dc-feb1-409c-bfa4-ef9e516aa281';
const otherId = 'wallos-companion-f9619526-e714-4a1e-aa64-2ed2f1050356';

describe('device-local Wallos credential references with Synchrun configuration sync', () => {
  it('migrates a valid legacy secret reference into vault-local storage', () => {
    const d = fixture({ [ownId]: 'only-on-this-device' });
    const refs = loadLocalCredentials(d.app, d.secretStore, { apiKeySecretId: ownId });
    expect(refs.apiKeySecretId).toBe(ownId);
    expect(JSON.stringify([...d.local.values()])).not.toContain('only-on-this-device');
    expect(refs.accessClientIdSecretId).toBe('');
  });

  it('recovers the local legacy reference when synced data points to the other device', () => {
    const d = fixture({ [ownId]: 'local-token' });
    const refs = loadLocalCredentials(d.app, d.secretStore, { apiKeySecretId: otherId });
    expect(refs.apiKeySecretId).toBe(ownId);
  });

  it('does not confuse devices when they share the same synced settings', () => {
    const first = fixture({ [ownId]: 'token-1' });
    const second = fixture({ [otherId]: 'token-2' });
    const synced = { baseUrl: 'https://wallos.example.com', apiKeySecretId: ownId, refreshMinutes: 10 };
    const a = loadLocalCredentials(first.app, first.secretStore, synced);
    const b = loadLocalCredentials(second.app, second.secretStore, synced);
    expect(a.apiKeySecretId).toBe(ownId);
    expect(b.apiKeySecretId).toBe(otherId);
    const futureSync = { ...synced, apiKeySecretId: otherId };
    expect(loadLocalCredentials(first.app, first.secretStore, futureSync).apiKeySecretId).toBe(ownId);
    expect(loadLocalCredentials(second.app, second.secretStore, futureSync).apiKeySecretId).toBe(otherId);
  });

  it('does not resurrect credentials after an explicit logout even with remote legacy settings', () => {
    const d = fixture({ [ownId]: 'token-1' });
    const refs = loadLocalCredentials(d.app, d.secretStore, { apiKeySecretId: ownId });
    refs.apiKeySecretId = '';
    persistLocalCredentials(d.app, refs);
    expect(loadLocalCredentials(d.app, d.secretStore, { apiKeySecretId: ownId }).apiKeySecretId).toBe('');
  });

  it('does not guess between multiple orphaned legacy secrets', () => {
    const d = fixture({ [ownId]: 'token-1', [otherId]: 'token-2' });
    const refs = loadLocalCredentials(d.app, d.secretStore, { apiKeySecretId: 'foreign-id' });
    expect(refs.apiKeySecretId).toBe('');
  });

  it('keeps credential IDs and values out of the syncable plugin data.json', () => {
    const old = {
      baseUrl: 'https://wallos.example.com',
      refreshMinutes: 10,
      apiKeySecretId: ownId,
      accessClientIdSecretId: 'access-id',
      accessClientSecretSecretId: 'access-secret',
    };
    const result = omitCredentialsFromSettings(old);
    expect(result).toEqual({ baseUrl: old.baseUrl, refreshMinutes: 10 });
    expect(JSON.stringify(result)).not.toMatch(/wallos-companion|access-secret|access-id/);
  });
});
