import { test, expect } from '@playwright/test';

test('mode banner uses runtime metadata and the proposal identifies its own model', async ({
  page,
}) => {
  await page.route('**/api/session', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), mode: 'anthropic', modelVersion: 'claude-sonnet-5-5' },
    });
  });
  await page.goto('/');
  await expect(page.locator('#model-mode')).toContainText('claude-sonnet-5-5');
  await page.getByLabel('Demo case').selectOption('dev-rounding');
  const selectedReview = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/review') && url.searchParams.has('threadId');
  });
  await page.getByRole('button', { name: 'Load example' }).click();
  const selectedRequest = await selectedReview;
  const savedThread = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('payment-review')!).threadId,
  );
  expect(new URL(selectedRequest.url()).searchParams.get('threadId')).toBe(savedThread);
  await expect(page.locator('#references')).toContainText('Proposal model: fake-scripted-v1');
});

test('a delayed evidence response cannot overwrite the newly selected receipt', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Demo case').selectOption('dev-rounding');
  await page.getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('#receipt-label')).toContainText('dev-rounding-receipt');
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    captured = resolve;
  });
  await page.route('**/api/evidence/source/dev-rounding-pos/1', async (route) => {
    const response = await route.fetch();
    captured();
    await blocked;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'dev-rounding-pos v1', exact: true }).click();
    await intercepted;
    await page.getByLabel('Demo case').selectOption('dev-missing-policy');
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect(page.locator('#status')).toHaveText('Needs more evidence');
    await page.getByRole('button', { name: 'dev-missing-policy-pos v1', exact: true }).click();
    await expect(page.locator('#evidence-record')).toContainText('dev-missing-policy-pos');
    const lateResponse = page.waitForResponse('**/api/evidence/source/dev-rounding-pos/1');
    release();
    await (await lateResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator('#evidence-record')).toContainText('dev-missing-policy-pos');
    await expect(page.locator('#receipt-label')).toContainText('dev-missing-policy-receipt');
    await expect(page.locator('#status')).toHaveText('Needs more evidence');
  } finally {
    release();
  }
});
test('review evidence and accept without changing either source total', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo case').selectOption('dev-rounding');
  await page.getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('#status')).toHaveText('Awaiting review');
  await page.getByRole('button', { name: 'dev-rounding-p1 v1', exact: true }).click();
  await expect(page.locator('#evidence-record')).toContainText('Fictional POS policy');
  await page.getByRole('button', { name: 'Accept explanation', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('Reviewed / explained');
  await expect(page.locator('#pos-total')).toHaveText('$22.12');
  await expect(page.locator('#accounting-total')).toHaveText('$22.11');
  await page.screenshot({ path: 'test-results/review-desktop.png', fullPage: true });
});

test('a delayed review refresh cannot restore the previous receipt', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo case').selectOption('dev-rounding');
  await page.getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('#receipt-label')).toContainText('dev-rounding-receipt');
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let captured!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const oldReview = '**/api/batches/dev-rounding-batch/receipts/dev-rounding-receipt/review*';
  await page.route(oldReview, async (route) => {
    const response = await route.fetch();
    captured();
    await blocked;
    await route.fulfill({ response });
  });
  try {
    await page.reload();
    await intercepted;
    await page.getByLabel('Demo case').selectOption('dev-missing-policy');
    await page.getByRole('button', { name: 'Load example' }).click();
    await expect(page.locator('#status')).toHaveText('Needs more evidence');
    const lateResponse = page.waitForResponse(oldReview);
    release();
    await (await lateResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator('#receipt-label')).toContainText('dev-missing-policy-receipt');
    await expect(page.locator('#status')).toHaveText('Needs more evidence');
  } finally {
    release();
  }
});
test('missing evidence has no acceptance action and source markup stays text', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Demo case').selectOption('dev-missing-policy');
  await page.getByRole('button', { name: 'Load example' }).click();
  await expect(page.locator('#status')).toHaveText('Needs more evidence');
  await expect(page.getByRole('button', { name: 'Accept explanation', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'dev-missing-policy-pos v1', exact: true }).click();
  await expect(page.locator('#evidence-record')).toContainText(
    '<script>window.__injected=1</script>',
  );
  expect(await page.evaluate(() => '__injected' in window)).toBe(false);
});
test('mobile layout fits and native keyboard actions remain available', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await page.getByLabel('Demo case').selectOption('dev-missing-policy');
  await page.getByRole('button', { name: 'Load example' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toHaveText('Needs more evidence');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/review-mobile.png', fullPage: true });
});
