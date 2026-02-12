import { spawnSync } from 'node:child_process';
import { rm, cp } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const outputDir = path.join(rootDir, '.output');
const buildDir = path.join(outputDir, 'chrome-mv3');
const stagingDir = path.join(outputDir, 'chrome-package');
const version = process.env.npm_package_version ?? '0.0.0';
const zipPath = path.join(outputDir, `nufftabs-${version}-chrome.zip`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status ?? 'unknown'}`);
  }
}

await rm(stagingDir, { recursive: true, force: true });
await rm(zipPath, { force: true });

run('pnpm', ['exec', 'wxt', 'build']);

await cp(buildDir, stagingDir, { recursive: true });
await cp(path.join(rootDir, 'README.md'), path.join(stagingDir, 'README.md'));
await rm(path.join(stagingDir, 'docs'), { recursive: true, force: true });

run('zip', ['-rq', zipPath, '.'], { cwd: stagingDir });

console.log(`Created ${zipPath}`);
