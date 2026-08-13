import { build } from 'esbuild';
import { createBuildOptions } from './build-options.mjs';

await build(await createBuildOptions());

