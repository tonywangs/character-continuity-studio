import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, basename } from 'node:path';
import { cpus, platform, arch } from 'node:os';
import { MODEL, RUNTIME } from './character-model.js';

export async function modelProvenance(properties, modelPath = `.cache/models/${MODEL.file}`) {
  // Read only the explicitly selected local weights, never an arbitrary path
  // supplied by an inference endpoint.
  if (resolve(properties.model_path) !== resolve(modelPath)) {
    throw Error('Server model differs from selected weights; set CONTINUITY_MODEL to the local GGUF used by this server');
  }
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(modelPath)) digest.update(chunk);
  const sha256 = digest.digest('hex');
  const model = sha256 === MODEL.sha256 ? MODEL : { file: basename(modelPath), sha256, repo: 'user-selected local GGUF', revision: null };
  const build = /^([^-]+)-(.+)$/.exec(properties.build_info);
  if (!build) throw Error('Cannot identify llama.cpp server build');
  return { model, runtime: properties.build_info === `${RUNTIME.tag}-${RUNTIME.commit}` ? RUNTIME : { tag: build[1], commit: build[2] },
    host: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCPUs: cpus().length },
    verification: 'SHA-256 computed from the selected local GGUF; server identity is also archived in server-properties.json.' };
}
