import { type AssetNode, archivedMeta, findBuiltinProfile, packMdl } from '@mdleaf/core';
import { live } from '@/services/liveClient.ts';
import type { StorageApi } from './api.ts';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // In pieces: passing a whole image as arguments overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const fromBase64 = (base64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

function filePaths(node: AssetNode): string[] {
  return node.kind === 'file' ? [node.path] : node.children.flatMap(filePaths);
}

async function readBytes(id: string, path: string): Promise<Uint8Array> {
  return fromBase64((await live.request('readAsset', { id, path })).base64);
}

/** The per-document storage calls for a workspace on disk. `client.ts` routes `agent-…` document ids here. */
export const agentStorage: Pick<
  StorageApi,
  | 'readDocument'
  | 'writeMarkdown'
  | 'updateMeta'
  | 'listAssets'
  | 'readAsset'
  | 'writeAsset'
  | 'createFolder'
  | 'moveAsset'
  | 'deleteAssets'
  | 'exportMdl'
> = {
  readDocument: (id) => live.request('readDocument', { id }),
  writeMarkdown: (id, markdown) => live.request('writeMarkdown', { id, markdown }),
  updateMeta: (id, patch) => live.request('updateMeta', { id, patch }),
  listAssets: (id) => live.request('listAssets', { id }),
  async readAsset(id, path) {
    const { base64, type, name, lastModified } = await live.request('readAsset', { id, path });
    return new File([fromBase64(base64)], name, { type, lastModified });
  },
  async writeAsset(id, path, data, { overwrite }) {
    return live.request('writeAsset', { id, path, base64: toBase64(new Uint8Array(await data.arrayBuffer())), overwrite });
  },
  createFolder: async (id, path) => void (await live.request('createFolder', { id, path })),
  moveAsset: async (id, from, to) => void (await live.request('moveAsset', { id, from, to })),
  deleteAssets: async (id, paths) => void (await live.request('deleteAssets', { id, paths })),
  async exportMdl(id) {
    const [{ meta, markdown }, tree] = await Promise.all([live.request('readDocument', { id }), live.request('listAssets', { id })]);
    const paths = filePaths(tree);
    const bytes = await Promise.all(paths.map((path) => readBytes(id, path)));
    const assets = Object.fromEntries(paths.map((path, i) => [path, bytes[i]]));
    const archive = packMdl({
      markdown,
      doc: archivedMeta(meta),
      profile: findBuiltinProfile(meta.profileId) ?? null,
      theme: null,
      assets,
    });
    return new Blob([archive as BlobPart], { type: 'application/x-mdleaf' });
  },
};
