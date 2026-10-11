import { describe, expect, it, vi } from 'vitest';
import { PairingClient } from '../src/pairing';
import type { RequestUrlParam } from 'obsidian';
describe('Wallos browser pairing', () => {
  it('never exposes the verifier in URL', async () => {
    const transport = vi.fn(async (_request: RequestUrlParam) => ({status:200,text:JSON.stringify({success:true,id:'a'.repeat(32),expires_in:180}),headers:{},arrayBuffer:new ArrayBuffer(0),json:{}}));
    await new PairingClient(() => 'https://wallos.example.com', transport).start('f'.repeat(64));
    expect(transport.mock.calls[0][0].url).toBe('https://wallos.example.com/obsidian-pair.php');
    expect(transport.mock.calls[0][0].body).toContain('verifier=');
  });
  it('rejects a Cloudflare Access HTML challenge rather than claiming login succeeded', async () => {
    const client = new PairingClient(() => 'https://wallos.example.com', async () => ({status:200,text:'<!doctype html><title>Access</title>',headers:{},arrayBuffer:new ArrayBuffer(0),json:{}}));
    await expect(client.start('f'.repeat(64))).rejects.toThrow('非 JSON');
  });
  it('rejects a forbidden pairing response', async () => {
    const client = new PairingClient(() => 'https://wallos.example.com', async () => ({status:403,text:'forbidden',headers:{},arrayBuffer:new ArrayBuffer(0),json:{}}));
    await expect(client.start('f'.repeat(64))).rejects.toThrow('HTTP 403');
  });
  it('rejects invalid claim response', async () => {
    const client = new PairingClient(() => 'https://wallos.example.com', async () => ({status:200,text:JSON.stringify({success:true,status:'approved'}),headers:{},arrayBuffer:new ArrayBuffer(0),json:{}}));
    await expect(client.claim('a'.repeat(32),'f'.repeat(64))).rejects.toThrow('API Key');
  });
});
