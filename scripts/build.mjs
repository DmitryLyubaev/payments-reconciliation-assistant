import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/ui', { recursive: true });
await mkdir('dist/storage', { recursive: true });
await build({
  entryPoints: ['src/ui/client.ts'],
  bundle: true,
  outfile: 'dist/ui/client.js',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
});
for (const file of ['index.html', 'styles.css'])
  await copyFile(`src/ui/${file}`, `dist/ui/${file}`);
await copyFile('src/storage/schema.sql', 'dist/storage/schema.sql');
