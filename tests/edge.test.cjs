const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../supabase/functions/book-assistant/index.ts'),'utf8'));
function setup({admin=true,validUser=true,grounded=true,legacyKey=true,geminiKey=true,searchEnabled=false}={}) {
  let handler; const calls = [];
  const env = { SUPABASE_URL:'https://test.supabase.co', ...(legacyKey?{SUPABASE_ANON_KEY:'test-anon'}:{SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'sb_publishable_test'})}), ...(geminiKey?{GEMINI_API_KEY:'test-secret'}:{}), ...(searchEnabled?{GEMINI_ENABLE_SEARCH:'true'}:{}) };
  const candidate = (value,metadata) => new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:typeof value==='string'?value:JSON.stringify(value)}]},groundingMetadata:metadata}]}));
  const context = vm.createContext({ Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},Response,Request,AbortSignal,TextDecoder,Uint8Array,URL,
    fetch:async (url,options)=>{
      calls.push({url,options});
      if(url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({id:'user-id'}),{status:validUser?200:401});
      if(url.includes('/admin_users')) return new Response(JSON.stringify(admin?[{user_id:'user-id'}]:[]));
      const body = JSON.parse(options.body);
      if(body.contents[0].parts.some(part=>part.inlineData)) return candidate({title:'หนังสือทดสอบ',author:'ผู้เขียนทดสอบ',note:''});
      if(body.tools) return candidate('Verified book research',grounded?{groundingChunks:[{web:{uri:'https://publisher.example/book',title:'Publisher'}}],searchEntryPoint:{renderedContent:'<div>Search</div>'}}:{});
      return candidate({category:'วรรณกรรม',description:'เรื่องย่อจากข้อมูลที่ตรวจสอบ',note:'ตรวจทานก่อนเผยแพร่'});
    }
  });
  vm.runInContext(source,context);
  const request = (auth=true,origin='http://localhost')=> new Request('https://test.supabase.co/functions/v1/book-assistant',{method:'POST',headers:{origin,'Content-Type':'application/json',...(auth?{Authorization:'Bearer test-token'}:{})},body:JSON.stringify({image:'data:image/jpeg;base64,/9j/2Q=='})});
  return {handler,calls,request};
}
test('AI endpoint rejects missing login, invalid token, non-admin, and unknown origin before Gemini',async()=>{
  for(const options of [{auth:false},{validUser:false},{admin:false},{origin:'https://untrusted.example'}]) {
    const {handler,calls,request}=setup(options);
    const response=await handler(request(options.auth??true,options.origin));
    assert([401,403].includes(response.status));
    assert(!calls.some(call=>call.url.includes('googleapis')));
  }
});
test('AI endpoint reads image, searches sources, structures results, and does not expose API key',async()=>{
  const {handler,calls,request}=setup({searchEnabled:true}); const response=await handler(request());
  assert.equal(response.status,200); const result=await response.json();
  assert.equal(result.title,'หนังสือทดสอบ'); assert.equal(result.category,'วรรณกรรม');
  assert.equal(result.sources[0].url,'https://publisher.example/book');
  assert.equal(calls.filter(call=>call.url.includes('googleapis')).length,3);
  assert(!JSON.stringify(result).includes('test-secret'));
});
test('AI free-tier default reads the cover without calling Google Search',async()=>{
  const {handler,calls,request}=setup(); const response=await handler(request()); const result=await response.json();
  assert.equal(response.status,200);
  assert.equal(result.title,'หนังสือทดสอบ'); assert.equal(result.author,'ผู้เขียนทดสอบ');
  assert.equal(result.description,''); assert.deepEqual(result.sources,[]);
  assert.match(result.note,/เติมหมวดหมู่และเรื่องย่อเอง/);
  assert.equal(calls.filter(call=>call.url.includes('googleapis')).length,1);
});
test('AI uses Supabase named publishable keys when legacy anon key is unavailable',async()=>{
  const {handler,calls,request}=setup({legacyKey:false}); const response=await handler(request());
  assert.equal(response.status,200);
  const supabaseCalls=calls.filter(call=>call.url.includes('/auth/v1/user')||call.url.includes('/admin_users'));
  assert.equal(supabaseCalls.length,2);
  assert(supabaseCalls.every(call=>call.options.headers.apikey==='sb_publishable_test'));
});
test('AI reports a missing Gemini secret clearly without sending an API request',async()=>{
  const {handler,calls,request}=setup({geminiKey:false}); const response=await handler(request()); const result=await response.json();
  assert.equal(response.status,502);
  assert.match(result.error,/GEMINI_API_KEY/);
  assert.equal(calls.filter(call=>call.url.includes('googleapis')).length,0);
});
test('AI endpoint leaves description empty if search has no grounded sources',async()=>{
  const {handler,calls,request}=setup({grounded:false,searchEnabled:true}); const response=await handler(request()); const result=await response.json();
  assert.equal(result.description,''); assert.deepEqual(result.sources,[]);
  assert.equal(calls.filter(call=>call.url.includes('googleapis')).length,2);
});
test('AI accepts the production Vercel origin and still rejects anonymous requests',async()=>{
  const {handler,request}=setup();
  const response=await handler(request(false,'https://bakkabook.vercel.app'));
  assert.equal(response.status,401);assert.equal(response.headers.get('access-control-allow-origin'),'https://bakkabook.vercel.app');
});
