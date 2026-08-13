import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import { createBuildOptions, outputFile, projectRoot } from './build-options.mjs';

const output = await readFile(outputFile, 'utf8');
const metadata = await readFile(`${projectRoot}/src/metadata.txt`, 'utf8');
const css = await readFile(`${projectRoot}/src/ui/panel.css`, 'utf8');
const rebuilt = await build(await createBuildOptions({ write: false, logLevel: 'silent' }));
const rebuiltText = rebuilt.outputFiles[0].text;

assert.ok(output.startsWith(metadata.trimEnd()), 'userscript metadata must begin at byte zero');
assert.equal((output.match(/\/\/ ==UserScript==/g) || []).length, 1, 'metadata header must occur once');
assert.match(output, /@run-at\s+document-start/);
assert.match(output, /@grant\s+none/);
assert.match(output, /==\/UserScript==\s*\n'use strict';/, 'classic userscript must retain strict mode');
assert.ok(output.includes('#mlf-panel'), 'panel CSS must be embedded in the bundle');
assert.ok(css.includes('#mlf-panel'), 'panel CSS must remain an authored source file');
assert.doesNotMatch(output, /^\s*(?:import|export)\s/m, 'bundle must not contain ES module syntax');
assert.equal(output, rebuiltText, 'committed userscript must match a clean deterministic build');
assert.doesNotThrow(() => new vm.Script(output), 'generated userscript must parse as classic JavaScript');

console.log('Verified metadata, embedded assets, deterministic output, and JavaScript syntax.');
