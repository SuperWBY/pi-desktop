import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startBackoffice } from './fixtures/business-backoffice/server.mjs'

const fixture = await startBackoffice()
const temp = await mkdtemp(join(tmpdir(), 'pi-business-fixture-'))
const payload = '订单编号,结果\nORD-2026-002,已核对\n'
const digest = createHash('sha256').update(payload).digest('hex')
let browser
try {
  const file = join(temp, '上传数据.csv')
  await writeFile(file, payload)
  browser = await chromium.launch({headless:true, executablePath:process.env.PI_TEST_CHROME || undefined})
  const page = await browser.newPage({acceptDownloads:true})
  await page.goto(fixture.url)
  await page.getByLabel('订单编号').fill('ORD-2026-002')
  await page.getByRole('button',{name:'查询订单'}).click()
  await page.getByRole('button',{name:'ORD-2026-002 青木测试商品 待处理'}).click()
  await assert.equal(await page.locator('#selected').innerText(),'已选择订单：ORD-2026-002')
  const downloading=page.waitForEvent('download')
  await page.getByRole('link',{name:'下载订单报表'}).click()
  const download=await downloading
  assert.equal(download.suggestedFilename(),'report.csv')
  assert.equal(await readFile(await download.path(),'utf8'),fixture.csv)
  await page.getByLabel('选择 CSV 文件').setInputFiles(file)
  await page.getByRole('button',{name:'上传资料'}).click()
  await page.getByText('上传成功：上传数据.csv · ORD-2026-002').waitFor()
  await page.getByRole('button',{name:'提交订单'}).click()
  await page.getByText('已提交：ORD-2026-002').waitFor()
  await page.getByRole('button',{name:'查询订单'}).click()
  await page.getByRole('button',{name:'ORD-2026-002 青木测试商品 已提交'}).waitFor({timeout:2000})
  const untouched=await (await fetch(fixture.url+'/api/records?q=ORD-2026-001')).json()
  assert.equal(untouched[0].status,'待处理')
  const state=await (await fetch(fixture.url+'/api/state')).json()
  assert.deepEqual(state.uploads,[{recordId:'ORD-2026-002',name:'上传数据.csv',sha256:digest,size:Buffer.byteLength(payload)}])
  assert.deepEqual(state.submissions,[{recordId:'ORD-2026-002',sha256:digest,status:'已提交'}])
  const duplicate=await fetch(fixture.url+'/api/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recordId:'ORD-2026-002',sha256:digest})})
  assert.equal(duplicate.status,409)
  assert.equal((await (await fetch(fixture.url+'/api/state')).json()).submissions.length,1)
  const wrong=await fetch(fixture.url+'/api/submit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({recordId:'ORD-2026-001',sha256:digest})})
  assert.equal(wrong.status,400)
  console.log('PASS local business fixture: exact record, downloaded bytes, uploaded file hash, server readback, duplicate and wrong-record rejection')
} finally {
  await browser?.close()
  await fixture.close()
  await rm(temp,{recursive:true,force:true})
}
