import { test,expect } from '@playwright/test';
test('review evidence and accept without changing either source total',async({page})=>{
 await page.goto('/');await page.getByLabel('Demo case').selectOption('dev-rounding');await page.getByRole('button',{name:'Load example'}).click();
 await expect(page.locator('#status')).toHaveText('Awaiting review');await page.getByRole('button',{name:'dev-rounding-p1 v1',exact:true}).click();await expect(page.locator('#evidence-record')).toContainText('Fictional POS policy');
 await page.getByRole('button',{name:'Accept explanation',exact:true}).click();await expect(page.locator('#status')).toHaveText('Reviewed / explained');await expect(page.locator('#pos-total')).toHaveText('$22.12');await expect(page.locator('#accounting-total')).toHaveText('$22.11');
 await page.screenshot({path:'test-results/review-desktop.png',fullPage:true});
});
test('missing evidence has no acceptance action and source markup stays text',async({page})=>{
 await page.goto('/');await page.getByLabel('Demo case').selectOption('dev-missing-policy');await page.getByRole('button',{name:'Load example'}).click();await expect(page.locator('#status')).toHaveText('Needs more evidence');await expect(page.getByRole('button',{name:'Accept explanation',exact:true})).toBeHidden();
 await page.getByRole('button',{name:'dev-missing-policy-pos v1',exact:true}).click();await expect(page.locator('#evidence-record')).toContainText('<script>window.__injected=1</script>');expect(await page.evaluate(()=>('__injected' in window))).toBe(false);
});
test('mobile layout fits and native keyboard actions remain available',async({page})=>{
 await page.setViewportSize({width:360,height:800});await page.goto('/');await page.getByLabel('Demo case').selectOption('dev-missing-policy');await page.getByRole('button',{name:'Load example'}).focus();await page.keyboard.press('Enter');await expect(page.locator('#status')).toHaveText('Needs more evidence');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/review-mobile.png',fullPage:true});
});
