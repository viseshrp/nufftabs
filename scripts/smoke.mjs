import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const requiredFiles = [
  'package.json',
  'wxt.config.ts',
  'README.md',
  'entrypoints/background/index.ts',
  'entrypoints/nufftabs/index.ts',
  'entrypoints/options/index.ts',
];

const missing = requiredFiles.filter((file) => !existsSync(resolve(process.cwd(), file)));
if (missing.length > 0) {
  console.error('Smoke check failed. Missing files:');
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

console.log('Smoke check passed.');
