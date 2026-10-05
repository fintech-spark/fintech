import { expect, test } from '@playwright/test';
import { useScenario, VIEWPORTS } from './helpers';

const routes = ['/overview','/sales','/expenses','/inventory','/customers','/suppliers','/cash-flow','/profit-leaks','/simulator','/business-brain','/documents','/notifications','/actions','/benchmarks','/settings'];
for (const [viewport, size] of Object.entries(VIEWPORTS)) {
  for (const theme of ['light','dark','system'] as const) {
    test(`${viewport} ${theme}: all merchant screens survive direct entry and refresh`, async ({page}) => {
      test.setTimeout(120000);
      await page.setViewportSize(size);
      await page.emulateMedia({colorScheme:'dark'});
      await useScenario(page.context(),'default');
      await page.addInitScript((mode) => localStorage.setItem('merchant-brain-theme',mode),theme);
      const errors: string[] = [];
      const failures: string[] = [];
      page.on('pageerror',(error) => errors.push(error.message));
      page.on('console',(msg) => {if (msg.type() === 'error' && /hydration|did not match|uncaught/i.test(msg.text())) errors.push(msg.text());});
      page.on('response',(response) => {if(response.status() >= 500 && response.url().includes('/api/')) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);});
      for (const route of routes) {
        const response = await page.goto(route);
        expect(response?.status(),route).toBe(200);
        await expect(page.locator('main h1'),route).toBeVisible();
        if (theme === 'light') await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
        else await expect(page.locator('html')).toHaveClass(/\bdark\b/);
        const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('main *')).filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1).slice(0,8).map((element) => ({tag:element.tagName,classes:element.className,right:element.getBoundingClientRect().right,text:element.textContent?.slice(0,80)})));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),`${route}: ${JSON.stringify(overflow)}`).toBe(true);
      }
      await page.reload();
      await expect(page.locator('main h1')).toBeVisible();
      expect(errors).toEqual([]);
      expect(failures).toEqual([]);
    });
  }
}
