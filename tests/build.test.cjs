const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bakkabook-build-'));
  for(const file of ['tools/build.mjs','assets/js/configuration.js','index.html','product.html','cart.html','payment.html','order.html','admin.html']){const target=path.join(temp,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target);}
  fs.writeFileSync(path.join(temp,'config.js'),'window.BAKKA_CONFIG = {supabaseUrl:"",supabaseAnonKey:"",aiFunctionName:"book-assistant"};');
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  return temp;
}
function build(temp,extra={}){
  const env={...process.env};
  for(const name of Object.keys(env))if(/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|VITE_SUPABASE_|VERCEL$|AI_FUNCTION_NAME$)/.test(name))delete env[name];
  return spawnSync(process.execPath,['tools/build.mjs'],{cwd:temp,env:{...env,...extra},encoding:'utf8'});
}
test('Vercel build injects public environment variables and packages only frontend files',t=>{
  const temp=fixture(t);
  const result=build(temp,{VERCEL:'1',SUPABASE_URL:'https://example.supabase.co/rest/v1/',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',GEMINI_API_KEY:'this-secret-must-never-be-published'});
  assert.equal(result.status,0,result.stderr);
  const source=fs.readFileSync(path.join(temp,'dist/config.js'),'utf8');const context={window:{}};vm.runInNewContext(source,context);
  assert.equal(context.window.BAKKA_CONFIG.supabaseUrl,'https://example.supabase.co');assert.equal(context.window.BAKKA_CONFIG.supabaseAnonKey,'sb_publishable_test');
  assert(!source.includes('this-secret-must-never-be-published'));
  assert.deepEqual(fs.readdirSync(path.join(temp,'dist')).sort(),['admin.html','assets','cart.html','config.js','index.html','order.html','payment.html','product.html']);
});
test('Vercel build refuses missing credentials and secret keys without publishing them',t=>{
  const temp=fixture(t);
  let result=build(temp,{VERCEL:'1'});assert.notEqual(result.status,0);assert(result.stderr.includes('SUPABASE_PUBLISHABLE_KEY'));
  result=build(temp,{VERCEL:'1',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_secret_should_not_be_published'});
  assert.notEqual(result.status,0);assert(!result.stderr.includes('sb_secret_should_not_be_published'));assert(!fs.existsSync(path.join(temp,'dist')));
});
test('local build retains intentional demo mode',t=>{const temp=fixture(t);const result=build(temp);assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('mode: demo'));});
