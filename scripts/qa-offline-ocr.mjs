import {createRequire} from 'node:module'
const require=createRequire('/Users/qichen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')
const {chromium}=require('playwright')
const browser=await chromium.launch({channel:'chrome',headless:true})
const page=await browser.newPage()
const external=[]
await page.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external.push(route.request().url());return route.abort()})
await page.goto('http://127.0.0.1:5174/')
const result=await page.evaluate(async()=>{
 const c=document.createElement('canvas');c.width=800;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,800,200);ctx.fillStyle='black';ctx.font='60px Arial';ctx.fillText('MATH 12345',40,120)
 const {recognizeTypedImage}=await import('/src/lib/ocr.ts');return recognizeTypedImage(c.toDataURL(),'short-answer')
})
await browser.close()
if(!result.text.includes('12345')||external.length)throw new Error(JSON.stringify({result,external}))
console.log(JSON.stringify({offline:true,text:result.text,confidence:result.confidence,externalRequests:external.length}))
