import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build as bundle, transform } from 'esbuild';
const require = createRequire(import.meta.url);
const { resolve } = require('../assets/js/core/configuration.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const pages = [
  'index.html',
  'product.html',
  'cart.html',
  'payment.html',
  'order.html',
  'admin.html',
];
// Only public configuration belongs in the browser. Gemini credentials stay in Supabase.
const context = { window: {} };
vm.runInNewContext(await fs.readFile(path.join(root, 'config.js'), 'utf8'), context);
const local = context.window.BAKKA_CONFIG || {};
function env(...names) {
  for (const name of names) if (process.env[name]?.trim()) return process.env[name].trim();
  return '';
}
// Environment values are injected during build; a static browser cannot read process.env.
const envUrl = env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL');
const envKey = env(
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
);
const config = resolve({
  supabaseUrl: envUrl || (envKey ? '' : local.supabaseUrl),
  supabaseAnonKey: envKey || (envUrl ? '' : local.supabaseAnonKey),
  aiFunctionName: env('AI_FUNCTION_NAME') || local.aiFunctionName || 'book-assistant',
});
if (config.error) throw new Error(config.error);
if (process.env.VERCEL && config.mode === 'demo')
  throw new Error(
    'Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel Settings → Environment Variables, then Redeploy.',
  );
async function scripts(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? scripts(file) : file.endsWith('.js') ? [file] : [];
    }),
  );
  return nested.flat().sort();
}
function fingerprint(file, contents) {
  const extension = path.extname(file);
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 12);
  return file.slice(0, -extension.length) + '.' + hash + extension;
}

// Format source for people; minify only generated production assets.
// Keep scripts separate to preserve the existing defer order and shared globals.
const assets = await Promise.all(
  (await scripts(path.join(root, 'assets/js'))).map(async (file) => {
    const source = await fs.readFile(file, 'utf8');
    const { code } = await transform(source, {
      loader: 'js',
      target: 'es2022',
      charset: 'utf8',
      legalComments: 'none',
      minifyWhitespace: true,
      minifyIdentifiers: true,
      minifySyntax: false,
    });
    const relative = path.relative(root, file).split(path.sep).join('/');
    return { source: relative, target: fingerprint(relative, code), code };
  }),
);
// Expand local CSS imports at build time: the live site downloads one stylesheet.
// Preserve cascade order and skip syntax optimizations that could alter old overrides.
const stylesheet = await bundle({
  absWorkingDir: root,
  entryPoints: ['assets/css/style.css'],
  bundle: true,
  write: false,
  charset: 'utf8',
  legalComments: 'none',
  minifyWhitespace: true,
  minifyIdentifiers: false,
  minifySyntax: false,
});
const css = stylesheet.outputFiles[0].text;
assets.push({
  source: 'assets/css/style.css',
  target: fingerprint('assets/css/style.css', css),
  code: css,
});
const references = new Map(assets.map((asset) => [asset.source, asset.target]));
const html = await Promise.all(
  pages.map(async (file) => {
    const source = await fs.readFile(path.join(root, file), 'utf8');
    return {
      file,
      code: source.replace(/\b(src|href)="([^"]+)"/g, (match, attribute, url) => {
        const original = url.split(/[?#]/)[0];
        return references.has(original) ? `${attribute}="${references.get(original)}"` : match;
      }),
    };
  }),
);

// Validate and compile first; replace only the known output directory in this project.
function outputPath(relative = '') {
  const target = path.resolve(output, relative);
  if (
    path.dirname(output) !== root ||
    path.basename(output) !== 'dist' ||
    (target !== output && !target.startsWith(output + path.sep))
  )
    throw new Error('Unexpected build directory');
  return target;
}
await fs.rm(outputPath(), { recursive: true, force: true });
await fs.mkdir(outputPath(), { recursive: true });
await fs.cp(path.join(root, 'assets'), outputPath('assets'), { recursive: true });
await fs.rm(outputPath('assets/css'), { recursive: true });
for (const asset of assets) {
  const target = outputPath(asset.target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, asset.code);
  if (asset.source.endsWith('.js')) await fs.unlink(outputPath(asset.source));
}
for (const page of html) await fs.writeFile(outputPath(page.file), page.code);
for (const file of ['robots.txt', 'sitemap.xml']) {
  await fs.copyFile(path.join(root, file), outputPath(file));
}
const publicConfig = {
  supabaseUrl: config.supabaseUrl,
  supabaseAnonKey: config.supabaseAnonKey,
  aiFunctionName: config.aiFunctionName,
};
await fs.writeFile(
  outputPath('config.js'),
  '// Generated public configuration. No secret keys.\nwindow.BAKKA_CONFIG = ' +
    JSON.stringify(publicConfig) +
    ';\n',
);
console.log('Bakkabook static build ready: dist/ · mode: ' + config.mode);
