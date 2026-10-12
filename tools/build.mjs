import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { resolve } = require('../assets/js/configuration.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
const context = { window:{} };
vm.runInNewContext(await fs.readFile(path.join(root,'config.js'),'utf8'), context);
const local = context.window.BAKKA_CONFIG || {};
function env(...names) {
  for (const name of names) if (process.env[name]?.trim()) return process.env[name].trim();
  return '';
}
// Environment values are injected during build; a static browser cannot read process.env.
const envUrl = env('SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','VITE_SUPABASE_URL');
const envKey = env('SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY','VITE_SUPABASE_PUBLISHABLE_KEY','VITE_SUPABASE_ANON_KEY');
const config = resolve({
  supabaseUrl: envUrl || (envKey ? '' : local.supabaseUrl),
  supabaseAnonKey: envKey || (envUrl ? '' : local.supabaseAnonKey),
  aiFunctionName: env('AI_FUNCTION_NAME') || local.aiFunctionName || 'book-assistant'
});
if (config.error) throw new Error(config.error);
if (process.env.VERCEL && config.mode === 'demo') throw new Error('Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel Settings → Environment Variables, then Redeploy.');
// Validate first, then replace only the known build output inside this project.
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Unexpected build directory');
await fs.rm(output, { recursive:true, force:true });
await fs.mkdir(output, { recursive:true });
for (const file of ['index.html','product.html','cart.html','payment.html','order.html','admin.html']) await fs.copyFile(path.join(root,file),path.join(output,file));
await fs.cp(path.join(root,'assets'),path.join(output,'assets'),{recursive:true});
const publicConfig = { supabaseUrl:config.supabaseUrl, supabaseAnonKey:config.supabaseAnonKey, aiFunctionName:config.aiFunctionName };
await fs.writeFile(path.join(output,'config.js'),'// Generated public configuration. No secret keys.\nwindow.BAKKA_CONFIG = '+JSON.stringify(publicConfig,null,2)+';\n');
console.log('Bakkabook static build ready: dist/ · mode: '+config.mode);
