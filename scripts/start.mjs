import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const local = fileURLToPath(new URL('../.tools/node-v24.22.1-win-x64/node.exe', import.meta.url));
const runtime = existsSync(local) ? local : process.execPath;
const child = spawn(runtime, ['dist/index.js', ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
