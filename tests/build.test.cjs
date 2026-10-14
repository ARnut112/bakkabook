const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function fixture(t) {
  const fixtures = path.join(root, 'test-results', 'build-fixtures');
  fs.mkdirSync(fixtures, { recursive: true });
  const temp = fs.mkdtempSync(path.join(fixtures, 'bakkabook-build-'));
  for (const file of [
    'tools/build.mjs',
    'index.html',
    'product.html',
    'cart.html',
    'payment.html',
    'order.html',
    'admin.html',
    'robots.txt',
    'sitemap.xml',
  ]) {
    const target = path.join(temp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, file), target);
  }
  fs.cpSync(path.join(root, 'assets'), path.join(temp, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(temp, 'config.js'),
    'window.BAKKA_CONFIG = {supabaseUrl:"",supabaseAnonKey:"",aiFunctionName:"book-assistant"};',
  );
  t.after(() => {
    if (path.dirname(temp) !== fixtures) throw new Error('Unexpected test directory');
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return temp;
}
function build(temp, extra = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|VITE_SUPABASE_|VERCEL$|AI_FUNCTION_NAME$)/.test(name))
      delete env[name];
  return spawnSync(process.execPath, ['tools/build.mjs'], {
    cwd: temp,
    env: { ...env, ...extra },
    encoding: 'utf8',
  });
}
test('Vercel build injects public environment variables and packages only frontend files', (t) => {
  const temp = fixture(t);
  const result = build(temp, {
    VERCEL: '1',
    SUPABASE_URL: 'https://example.supabase.co/rest/v1/',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    GEMINI_API_KEY: 'this-secret-must-never-be-published',
  });
  assert.equal(result.status, 0, result.stderr);
  const source = fs.readFileSync(path.join(temp, 'dist/config.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  assert.equal(context.window.BAKKA_CONFIG.supabaseUrl, 'https://example.supabase.co');
  assert.equal(context.window.BAKKA_CONFIG.supabaseAnonKey, 'sb_publishable_test');
  assert(!source.includes('this-secret-must-never-be-published'));
  assert.deepEqual(fs.readdirSync(path.join(temp, 'dist')).sort(), [
    'admin.html',
    'assets',
    'cart.html',
    'config.js',
    'index.html',
    'order.html',
    'payment.html',
    'product.html',
    'robots.txt',
    'sitemap.xml',
  ]);
});
test('Vercel build refuses missing credentials and secret keys without publishing them', (t) => {
  const temp = fixture(t);
  let result = build(temp, { VERCEL: '1' });
  assert.notEqual(result.status, 0);
  assert(result.stderr.includes('SUPABASE_PUBLISHABLE_KEY'));
  result = build(temp, {
    VERCEL: '1',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_secret_should_not_be_published',
  });
  assert.notEqual(result.status, 0);
  assert(!result.stderr.includes('sb_secret_should_not_be_published'));
  assert(!fs.existsSync(path.join(temp, 'dist')));
});
test('local build retains intentional demo mode', (t) => {
  const temp = fixture(t);
  const result = build(temp);
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes('mode: demo'));
});

test('production pages resolve fingerprinted assets and download one bundled stylesheet', (t) => {
  const temp = fixture(t);
  const result = build(temp);
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(temp, 'dist');
  for (const page of ['index', 'product', 'cart', 'payment', 'order', 'admin']) {
    const html = fs.readFileSync(path.join(output, page + '.html'), 'utf8');
    const references = [...html.matchAll(/\b(?:src|href)="(assets\/[^"?#]+)/g)].map(
      (match) => match[1],
    );
    assert(references.length > 0, page);
    for (const reference of references) {
      assert(fs.existsSync(path.join(output, reference)), reference);
      if (/\.(js|css)$/.test(reference)) assert.match(reference, /\.[a-f0-9]{12}\.(js|css)$/);
    }
    const stylesheets = references.filter((reference) => reference.endsWith('.css'));
    assert.equal(stylesheets.length, 1, page);
    assert(!fs.readFileSync(path.join(output, stylesheets[0]), 'utf8').includes('@import'));
  }
});

test('changed stylesheet content gets a new URL while unchanged scripts retain theirs', (t) => {
  const temp = fixture(t);
  assert.equal(build(temp).status, 0);
  const page = () => fs.readFileSync(path.join(temp, 'dist/index.html'), 'utf8');
  const before = page();
  fs.appendFileSync(
    path.join(temp, 'assets/css/base/site.css'),
    '\n.build-regression { color: red; }\n',
  );
  assert.equal(build(temp).status, 0);
  const after = page();
  const css = (html) => html.match(/href="(assets\/css\/[^\"]+)"/)[1];
  const js = (html) => [...html.matchAll(/src="(assets\/js\/[^\"]+)"/g)].map((match) => match[1]);
  assert.notEqual(css(before), css(after));
  assert.deepEqual(js(before), js(after));
});
