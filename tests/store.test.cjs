const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname,'..');
function storage() {
  const data = new Map();
  return { getItem:key => data.get(key) ?? null, setItem:(key,value) => data.set(key,value), removeItem:key => data.delete(key) };
}
function app(config = {}, fetch = () => { throw new Error('Unexpected network request'); }) {
  const context = vm.createContext({ window:{ BAKKA_CONFIG:config, dispatchEvent:()=>{} }, CustomEvent:class { constructor(type) { this.type=type; } }, localStorage:storage(), sessionStorage:storage(), structuredClone, crypto:webcrypto, URL, AbortSignal, atob, fetch });
  for (const file of ['data.js','configuration.js','store.js']) vm.runInContext(fs.readFileSync(path.join(root,'assets/js',file),'utf8'),context);
  return { store:context.window.BakkaStore, context, seed:context.window.BAKKA_SEED };
}
const response = (data,status=200) => ({ ok:status < 400, status, text:async () => JSON.stringify(data) });
test('demo creates, edits, persists, hides drafts, and deletes a book', async () => {
  const { store, context, seed } = app();
  assert.equal((await store.list()).length,12);
  const created = await store.save({...seed[0],title:'เล่มทดสอบ',status:'draft'});
  assert.equal((await store.list()).length,12);
  assert.equal((await store.list(true)).length,13);
  assert.equal(await store.get(created.id),null);
  assert.equal((await store.get(created.id,true)).title,'เล่มทดสอบ');
  await store.save({...created,price:199,stock:0,status:'published'},created.id);
  assert.equal((await store.get(created.id)).price,199);
  vm.runInContext(fs.readFileSync(path.join(root,'assets/js/store.js'),'utf8'),context);
  assert.equal((await context.window.BakkaStore.get(created.id)).stock,0);
  await store.remove(created.id);
  assert.equal((await store.list()).length,12);
  assert.equal(await store.get(created.id),null);
});
test('search, category, sorting, favorites, and reset do not mutate source', async () => {
  const { store } = app(); const books = await store.list(); const original = books.map(b=>b.id).join();
  const filtered = store.filter(books,{query:'ณิชา',category:'วรรณกรรม',sort:'price-low'});
  assert.equal(filtered.length,2); assert(filtered[0].price <= filtered[1].price);
  assert.equal(store.filter(books,{query:'ณิชา',category:'ท่องเที่ยว'}).length,0);
  assert.equal(store.filter(books,{query:'  THE SEASON  '}).length,1);
  const descending = store.filter(books,{sort:'price-high'});
  assert(descending.every((item,i)=>!i || item.price <= descending[i-1].price));
  store.toggleFavorite(books[0].id);
  assert.equal(store.filter(books,{favorites:true}).length,1);
  store.toggleFavorite(books[0].id);
  assert.equal(store.filter(books,{favorites:true}).length,0);
  assert.equal(store.filter(books).length,12); assert.equal(books.map(b=>b.id).join(),original);
});
test('cart persists item quantities and removes items when quantity is cleared',()=>{
  const {store}=app(); store.addToCart('book-01'); store.addToCart('book-01',2); store.addToCart('book-02');
  assert.deepEqual(JSON.parse(JSON.stringify(store.cart())),[{id:'book-01',quantity:3},{id:'book-02',quantity:1}]);
  store.setCartQuantity('book-01',2); store.setCartQuantity('book-02',0);
  assert.deepEqual(JSON.parse(JSON.stringify(store.cart())),[{id:'book-01',quantity:2}]);
  store.clearCart(); assert.equal(store.cart().length,0);
});
test('checkout stores the resumable order and sends the selected payment method',async()=>{
  let call;
  const {store}=app({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_test'},async (url,options)=>{call={url,options};return response({order_number:'BK-261012-ABC123',order_id:'order-uuid'});});
  store.addToCart('book-id',2);
  const order=await store.placeOrder({name:'น้องนัท',phone:'0812345678',line_id:'nattan_book',address:'กรุงเทพมหานคร',note:'โทรก่อนส่ง',payment_method:'qr'});
  assert.deepEqual(JSON.parse(JSON.stringify(order)),{order_number:'BK-261012-ABC123',order_id:'order-uuid'}); assert.match(call.url,/rpc\/submit_book_order$/);
  assert.deepEqual(JSON.parse(call.options.body),{p_customer_name:'น้องนัท',p_phone:'0812345678',p_line_id:'nattan_book',p_address:'กรุงเทพมหานคร',p_note:'โทรก่อนส่ง',p_payment_method:'qr',p_items:[{book_id:'book-id',quantity:2}]});
  assert.deepEqual(JSON.parse(JSON.stringify(store.lastOrder())),{order_number:'BK-261012-ABC123',order_id:'order-uuid',phone:'0812345678',payment_method:'qr'});
});
test('customer can resume an order with its number and phone without exposing table reads',async()=>{
  let call;
  const {store}=app({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_test'},async(url,options)=>{call={url,options};return response({order_number:'BK-123',status:'awaiting_payment'});});
  const order=await store.getCustomerOrder('BK-123','0812345678');
  assert.equal(order.status,'awaiting_payment');assert.match(call.url,/rpc\/get_customer_order$/);
  assert.deepEqual(JSON.parse(call.options.body),{p_order_number:'BK-123',p_phone:'0812345678'});
});
test('order management requests are sent with the signed-in admin session',async()=>{
  const calls=[];
  const {store}=app({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_test'},async (url,options)=>{
    calls.push({url,options});
    if(url.includes('/auth/v1/token')) return response({access_token:'admin-token',refresh_token:'refresh',expires_in:3600,user:{id:'owner'}});
    if(url.includes('/admin_users')) return response([{user_id:'owner'}]);
    return response(url.includes('/orders?') ? [{order_number:'BK-123'}] : null);
  });
  await store.login('owner@example.com','test');
  assert.equal((await store.listOrders())[0].order_number,'BK-123');
  await store.updateOrderStatus('order-id','confirmed');
  await store.updateOrderWorkflow('order-id','awaiting_payment',35);
  const protectedCalls=calls.filter(call=>call.url.includes('/rest/v1/orders?') || call.url.includes('/rpc/update_book_order_status') || call.url.includes('/rpc/update_order_workflow'));
  assert.equal(protectedCalls.length,3);
  assert(protectedCalls.every(call=>call.options.headers.Authorization==='Bearer admin-token'));
});
test('validation and storage exhaustion preserve existing books', async () => {
  const { store, context, seed } = app();
  for (const invalid of [{price:-1},{price:'abc'},{stock:1.5},{pages:0},{title:'  '},{category:'bad'},{images:[]}]) {
    await assert.rejects(store.save({...seed[0],...invalid}));
  }
  await assert.rejects(store.save(seed[0],'deleted-id'));
  context.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(store.save(seed[0]),/พื้นที่/);
  assert.equal((await store.list()).length,12);
});
test('live uses published-only reads and admin writes with a session token', async () => {
  const calls = [];
  const { store, seed } = app({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_test'},async (url,options)=>{
    calls.push({url,options});
    if(url.includes('/auth/v1/token')) return response({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:'user-id'}});
    if(url.includes('/admin_users')) return response([{user_id:'user-id'}]);
    return response([{id:'live-book-id'}]);
  });
  await store.list(); assert(calls.at(-1).url.includes('status=eq.published'));
  assert.equal(calls.at(-1).options.headers.apikey,'sb_publishable_test');
  await store.login('owner@example.com','not-a-real-password');
  assert.equal(await store.isAdmin(),true);
  await store.save({...seed[0],images:['https://example.com/book.jpg']});
  const write = calls.at(-1); assert.equal(write.options.method,'POST'); assert.equal(write.options.headers.Authorization,'Bearer test-access');
  assert.equal(JSON.parse(write.options.body).title,seed[0].title);
  await store.save({...seed[0],images:['https://example.com/book.jpg']},'live-book-id');
  assert.equal(calls.at(-1).options.method,'PATCH');
  await store.remove('live-book-id'); assert.equal(calls.at(-1).options.method,'DELETE');
});
test('a logged in non-admin is rejected and session is removed', async () => {
  const { store } = app({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_test'},async url=> {
    if(url.includes('/token')) return response({access_token:'token',refresh_token:'r',expires_in:3600,user:{id:'not-admin'}});
    return response([]);
  });
  await assert.rejects(store.login('test@example.com','test'),/สิทธิ์/); assert.equal(store.session(),null);
});
test('all sample book illustrations exist locally',()=>{
  const { seed } = app(); for (const book of seed) for (const image of book.images) assert(fs.existsSync(path.join(root,image)),image);
});

test('configuration trims whitespace and converts Data API URL to project URL',async()=>{
  let requested;
  const {store}=app({supabaseUrl:' https://example.supabase.co/rest/v1/ ',supabaseAnonKey:' sb_publishable_test '},async url=>{requested=url;return response([]);});
  await store.list(); assert.equal(store.mode,'live'); assert.equal(requested,'https://example.supabase.co/rest/v1/books?select=*&order=created_at.desc&status=eq.published');
});
test('incomplete, invalid, and secret configurations cannot silently save to demo storage',async()=>{
  const configurations=[{supabaseUrl:'https://example.supabase.co'},{supabaseAnonKey:'sb_publishable_test'},{supabaseUrl:'sb_publishable_test',supabaseAnonKey:'sb_publishable_test'},{supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_secret_private'}];
  for(const config of configurations){const {store,seed}=app(config);assert.equal(store.mode,'invalid');await assert.rejects(store.list());await assert.rejects(store.save(seed[0]));}
});
test('expired admin session cannot block public reads and anonymous writes are refused',async()=>{
  const calls=[];
  const {store,context,seed}=app({supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_test'},async (url,options)=>{calls.push({url,options});return response([]);});
  const key='bakkabook.session.v2.https://example.supabase.co';
  context.sessionStorage.setItem(key,JSON.stringify({access_token:'expired',refresh_token:'expired',expires_at:1,user:{id:'owner'}}));
  await store.list(); await store.get('id');
  assert.equal(calls.length,2);assert(calls.every(c=>!c.url.includes('/auth/')&&!c.options.headers.Authorization));
  context.sessionStorage.removeItem(key);
  await assert.rejects(store.save({...seed[0],images:['https://example.com/cover.jpg']}),/เข้าสู่ระบบ/);
  assert.equal(calls.length,2);
});
test('network errors and missing tables explain the next action',async()=>{
  const config={supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'sb_publishable_test'};
  await assert.rejects(app(config,async()=>{throw new TypeError('Failed to fetch');}).store.list(),/เชื่อมต่อระบบไม่สำเร็จ/);
  await assert.rejects(app(config,async()=>response({code:'PGRST205',message:'missing'},404)).store.list(),/เตรียมข้อมูลไม่ครบ/);
});
