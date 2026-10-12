// Optional browser acceptance checks. Set PLAYWRIGHT_PATH to an installed playwright module.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const output = path.join(root,'test-results'); fs.mkdirSync(output,{recursive:true});
(async () => {
  let server;
  let base = process.env.TEST_BASE_URL;
  if (!base) {
    process.env.PORT = '0';
    server = (await import('../server.mjs')).default;
    if (!server.listening) await new Promise(resolve=>server.once('listening',resolve));
    base = 'http://127.0.0.1:' + server.address().port + '/';
  }
  const browser = await chromium.launch({headless:true, ...(process.env.BROWSER_PATH ? {executablePath:process.env.BROWSER_PATH} : {})});
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    page.on('dialog',dialog=>dialog.accept());
    await page.goto(base + 'index.html');
    await page.waitForSelector('.book-card');
    assert.equal(await page.locator('#book-grid .book-card').count(),8);
    assert.equal(await page.locator('#catalog-message .empty-state').count(),0,'the catalog should not show an error when books loaded');
    assert.equal(await page.locator('#result-count').textContent(),'12 เล่มบนชั้น');
    await page.screenshot({path:path.join(output,'home-desktop.png'),fullPage:true});
    await page.locator('#load-more').click(); assert.equal(await page.locator('#book-grid .book-card').count(),12);
    await page.locator('#search').fill('ณิชา'); await page.locator('[data-category="วรรณกรรม"]').click();
    assert.equal(await page.locator('#book-grid .book-card').count(),2);
    await page.locator('#sort').selectOption('price-low');
    assert.equal(await page.locator('.book-card-bottom strong').first().textContent(),'฿275');
    await page.locator('#sort').selectOption('price-high');
    assert.equal(await page.locator('.book-card-bottom strong').first().textContent(),'฿285');
    await page.locator('[data-category="ท่องเที่ยว"]').click(); assert(await page.locator('.empty-state').isVisible());
    await page.locator('[data-reset]').last().click(); assert.equal(await page.locator('#book-grid .book-card').count(),8);
    await page.locator('[data-save="book-01"]').click(); assert.equal(await page.locator('#favorite-count').textContent(),'1');
    await page.goto(base+'index.html'); await page.locator('[data-cart="book-01"]').click(); assert.equal(await page.locator('#cart-count').textContent(),'1');
    assert.equal(await page.locator('.main-nav a[href="order.html"]').count(),1,'tracking should be reachable from the store navigation');
    await page.goto(base+'cart.html'); await page.waitForSelector('#cart-content:not([hidden])');
    assert((await page.locator('.checkout-steps').textContent()).includes('แสดง QR'));
    assert.equal(await page.locator('[name="payment_method"]').count(),0);
    assert.equal(await page.locator('.cart-item').count(),1); await page.locator('[data-quantity="book-01"]').fill('2');
    assert.equal(await page.locator('#cart-count').textContent(),'2'); assert.equal(await page.locator('#cart-total').textContent(),'฿570');
    await page.locator('[data-remove-cart="book-01"]').click(); assert(await page.locator('#cart-empty').isVisible()); assert(!await page.locator('#place-order').isEnabled());
    await page.goto(base+'index.html?shelf=1'); await page.waitForSelector('.book-card'); assert.equal(await page.locator('.book-card').count(),1);
    await page.locator('.book-card h3 a').click(); await page.waitForSelector('.product-info');
    assert.equal(await page.locator('.product-info h1').textContent(),'ในวันที่ดอกไม้ผลิบาน');
    await page.locator('[data-image-index="1"]').click(); assert((await page.locator('#main-book-image').getAttribute('src')).includes('-back.svg'));
    await page.locator('[data-image-index="0"]').click(); await page.screenshot({path:path.join(output,'product-desktop.png'),fullPage:true});
    await page.goto(base+'admin.html'); await page.waitForSelector('#dashboard:not([hidden])');
    assert.equal(await page.locator('#book-table-body tr').count(),12);
    assert.equal(await page.locator('#mode-badge, #nav-setup, #setup-dialog, #demo-note, #demo-ai').count(),0);
    assert.equal(await page.locator('#ai-card h2').textContent(),'ผู้ช่วยอ่านปก');
    await page.screenshot({path:path.join(output,'admin-desktop.png'),fullPage:true});
    await page.locator('#add-book').click();
    const upload = await page.screenshot({clip:{x:0,y:0,width:120,height:180}});
    await page.locator('#book-images').setInputFiles({name:'test-cover.png',mimeType:'image/png',buffer:upload});
    await page.waitForSelector('.image-preview-item');
    assert((await page.locator('.image-preview-item img').getAttribute('src')).startsWith('data:image/jpeg;base64,'));
    await page.locator('[data-remove-image="0"]').click();
    assert.equal(await page.locator('.image-preview-item').count(),0);
    assert(await page.locator('#ai-help').textContent().includes('ชื่อหนังสือและผู้เขียน'));
    await page.locator('#book-title').fill('ทดสอบหนังสือใหม่'); await page.locator('#book-price').fill('199');
    await page.locator('[data-preset="joy"]').click(); await page.locator('[data-preset="bloom"]').click();
    await page.locator('#book-status').selectOption('draft');
    await page.screenshot({path:path.join(output,'editor-desktop.png'),fullPage:true});
    await page.locator('#save-book').click(); await page.waitForSelector('#dashboard:not([hidden])');
    assert.equal(await page.locator('#stat-total').textContent(),'13'); assert.equal(await page.locator('#stat-draft').textContent(),'1');
    await page.reload(); await page.waitForSelector('#dashboard:not([hidden])'); assert.equal(await page.locator('#stat-total').textContent(),'13');
    const row = page.locator('tr').filter({hasText:'ทดสอบหนังสือใหม่'});
    const id = await row.locator('[data-edit]').getAttribute('data-edit');
    await page.goto(base+'product.html?id='+id); await page.waitForSelector('.empty-state');
    assert((await page.locator('.empty-state').textContent()).includes('ไม่พบหนังสือ'));
    await page.goto(base+'admin.html'); await page.waitForSelector('#dashboard:not([hidden])');
    await page.locator('[data-edit="'+id+'"]').click();
    await page.locator('#book-status').selectOption('published'); await page.locator('#book-price').fill('225'); await page.locator('#book-stock').fill('0');
    await page.locator('#save-book').click(); await page.waitForSelector('#dashboard:not([hidden])');
    await page.goto(base+'product.html?id='+id); await page.waitForSelector('.product-info');
    assert.equal(await page.locator('.product-price-row>strong').textContent(),'฿225');
    assert((await page.locator('.stock-label').textContent()).includes('สินค้าหมด'));
    assert.equal(await page.locator('.thumbnail').count(),2);
    await page.goto(base+'admin.html'); await page.waitForSelector('#dashboard:not([hidden])');
    await page.locator('[data-delete="'+id+'"]').click(); await page.locator('#cancel-delete').click(); assert.equal(await page.locator('#stat-total').textContent(),'13');
    await page.locator('[data-delete="'+id+'"]').click(); await page.locator('#confirm-delete').click();
    await page.waitForFunction(()=>document.getElementById('stat-total').textContent==='12');
    for (const width of [390,768,1280]) {
      await page.setViewportSize({width,height:900});
      await page.goto(base+'order.html?payment=received');
      assert(await page.locator('#payment-thanks').isVisible());
      assert(await page.locator('#order-lookup').isHidden());
      assert(await page.locator('#order-results').isHidden());
      assert.equal(await page.locator('#payment-thanks a[href="order.html"]').count(),1);
      for (const [name,url,ready] of [['home','index.html','.book-card'],['product','product.html?id=book-01','.product-info'],['cart','cart.html','#cart-content:not([hidden])'],['order','order.html','.order-lookup'],['admin','admin.html','#dashboard:not([hidden])']]) {
        await page.goto(base+url); await page.waitForSelector(ready);
        if(name==='order'){assert.equal(await page.locator('#lookup-number').count(),0);assert.equal(await page.locator('#lookup-phone').count(),1);assert.equal(await page.locator('#refresh-orders').count(),1);}
        const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
        assert(!overflow, name+' overflows at '+width);
        if(width===390) await page.screenshot({path:path.join(output,name+'-mobile.png'),fullPage:true});
      }
      await page.locator('#add-book').click();
      assert(!await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),'editor overflows at '+width);
      if(width===390) await page.screenshot({path:path.join(output,'editor-mobile.png'),fullPage:true});
    }
    assert.deepEqual(errors,[]); console.log('PASS: search + filter + both sorts, empty/reset, favorites, cart + quantities, gallery, cover-reader UI, CRUD persistence, draft privacy, stock, responsive 390/768/1280, no JavaScript errors.');
  } finally { await browser.close(); if(server) server.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
