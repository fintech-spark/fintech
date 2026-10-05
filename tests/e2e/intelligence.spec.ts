import { expect, test } from '@playwright/test';
import { useScenario } from './helpers';

test('the health route reports the service is up', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
});
test('the simulator states assumptions and does not offer to execute a scenario', async ({ page }) => {
  await useScenario(page.context(),'default');
  await page.goto('/simulator');
  await expect(page.getByRole('heading',{level:1,name:/What-If Simulator/})).toBeVisible();
  await expect(page.getByRole('button',{name:'Run',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Execute|Apply prices/})).toHaveCount(0);
});
