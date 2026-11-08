import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const requireApp=createRequire(new URL('../../mf-employees/package.json',import.meta.url));
const {chromium}=requireApp('@playwright/test');
const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
const source=readFileSync(new URL('../src/offline/workspace.ts',import.meta.url),'utf8');
const start=source.indexOf('this.host.innerHTML =')+'this.host.innerHTML ='.length;
const end=source.indexOf(';'+String.fromCharCode(10)+'    this.el',start);
assert.ok(start>0&&end>start);
// Evaluate production string-literal markup without starting app sessions or storage.
const markup=Function('return ('+source.slice(start,end)+')')();
test('offline form stays within viewport and container at phone and desktop widths',{timeout:60000},async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page=await browser.newPage();
    await page.setContent('<meta name=viewport content=width=device-width,initial-scale=1><style>'+css+'</style><main id=offline-workspace>'+markup+'</main>');
    for(const width of [390,320,1440]) {
      await page.setViewportSize({width,height:900});
      const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,
        fields:[...document.querySelectorAll('#offline-form input:not([type=checkbox]),#offline-form textarea,#offline-form button')].map(field=>{const a=field.getBoundingClientRect(),b=field.closest('form').getBoundingClientRect();return {id:field.id,right:a.right,parent:b.right,left:a.left,parentLeft:b.left};})}));
      assert.ok(layout.scroll<=layout.width,JSON.stringify(layout));
      assert.ok(layout.fields.every(field=>field.right<=field.parent&&field.left>=field.parentLeft),JSON.stringify(layout));
    }
  }finally{await browser.close();}
});
