import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('VERIQO_WEB_URL','http://127.0.0.1:3000').rstrip('/')
OUT=Path(os.environ.get('VERIQO_BROWSER_OUTPUT','test-results/tenant-console'));OUT.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(**({'executable_path':os.environ['VERIQO_CHROMIUM_EXECUTABLE']} if os.environ.get('VERIQO_CHROMIUM_EXECUTABLE') else {}),args=['--no-sandbox'])
  context=await browser.new_context(viewport={'width':1440,'height':1080},accept_downloads=True)
  page=await context.new_page(); errors=[]
  page.on('pageerror',lambda error:errors.append(str(error)))
  await page.goto(BASE+'/',wait_until='domcontentloaded')
  await page.get_by_role('button',name='Developer',exact=True).click()
  await page.get_by_role('heading',name='Run and verify',exact=True).wait_for()
  cookies=await context.cookies(); cookie=next(c for c in cookies if c['name']=='veriqo_session')
  assert cookie['httpOnly'] and cookie['sameSite']=='Lax' and len(cookie['value'].split('.'))==5
  assert await page.evaluate('Object.keys(localStorage).length')==0
  assert (await context.request.get(BASE+'/api/v1/me')).status==200
  denied=await context.request.post(BASE+'/api/v1/workspaces',data={'name':'forbidden'},headers={'origin':'https://other.example'})
  assert denied.status==403
  await page.get_by_role('button',name='Publish scenario version').click()
  await page.get_by_label('Published version',exact=True).locator('option').nth(1).wait_for(state='attached')
  await page.get_by_role('button',name='Start run',exact=True).click()
  await page.get_by_role('heading',name='Outcome: PASS',exact=True).wait_for(timeout=30000)
  await page.screenshot(path=str(OUT/'desktop-pass.png'),full_page=True)
  async with page.expect_download() as info:
   await page.get_by_role('link',name='Export evidence').click()
  download=await info.value; export=OUT/'run-evidence.json';await download.save_as(str(export))
  result=json.loads(export.read_text());assert result['run']['verdict']=='PASS';run_id=result['run']['id']
  await page.get_by_label('Reference behavior',exact=True).select_option('wrong-tenant')
  await page.get_by_role('button',name='Start run',exact=True).click()
  await page.get_by_role('heading',name='Outcome: FAIL',exact=True).wait_for(timeout=30000)
  await page.screenshot(path=str(OUT/'desktop-fault.png'),full_page=True)
  await page.get_by_role('button',name='Sign out',exact=True).click()
  await page.get_by_role('button',name='Second workspace',exact=True).click()
  await page.get_by_role('heading',name='Run and verify',exact=True).wait_for()
  assert (await context.request.get(BASE+'/api/v1/runs/'+run_id)).status==404
  await page.get_by_role('button',name='Sign out',exact=True).click()
  await page.get_by_role('button',name='Reviewer (read only)',exact=True).click()
  await page.get_by_role('heading',name='Run and verify',exact=True).wait_for()
  assert await page.get_by_role('button',name='Publish scenario version').is_disabled()
  assert await page.get_by_role('button',name='Start run',exact=True).is_disabled()
  await page.set_viewport_size({'width':390,'height':844});await page.screenshot(path=str(OUT/'mobile-reviewer.png'),full_page=True)
  assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  await page.get_by_role('button',name='Sign out',exact=True).click()
  assert (await context.request.get(BASE+'/api/v1/me')).status==401
  assert not errors,errors
  print('Browser passed: encrypted HttpOnly session, no localStorage credential, origin rejection, publish/run/pass/fault/export, tenant isolation, viewer restrictions, logout, mobile layout. Artifacts: '+str(OUT))
  await browser.close()
asyncio.run(main())
