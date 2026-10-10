import esbuild from 'esbuild';
import process from 'node:process';

const production = process.argv.includes('production');
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  platform: 'browser',
  target: ['es2020'],
  format: 'cjs',
  outfile: 'main.js',
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
});
if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
  console.log('Watching Wallos plugin sources...');
}
