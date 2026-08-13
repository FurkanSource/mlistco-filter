import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptsDirectory, '..');
export const outputFile = path.join(projectRoot, 'mlistco-filter.user.js');

export async function createBuildOptions({ write = true, logLevel = 'info' } = {}) {
  const metadata = await readFile(path.join(projectRoot, 'src', 'metadata.txt'), 'utf8');
  return {
    entryPoints: [path.join(projectRoot, 'src', 'main.js')],
    outfile: outputFile,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: false,
    loader: {
      '.css': 'text',
      '.html': 'text',
    },
    banner: {
      js: `${metadata.trimEnd()}\n'use strict';`,
    },
    write,
    logLevel,
  };
}
