import { test, expect, type Page } from '@playwright/test';

async function startGame(page: Page): Promise<void> {
  for (const s of ['alchemy', 'elemental', 'mentalism']) {
    await page.check(`input[value="${s}"]`);
  }
  await page.check('input[name="seat1"][value="bot"]');
  await page.click('.setup__start');
}

test.describe('Wiz-War hot-seat game', () => {
  test('shows setup screen with title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Wiz-War Setup');
    await expect(page.locator('.setup__start')).toBeVisible();
  });

  test('renders the board after starting a game', async ({ page }) => {
    await page.goto('/');
    await startGame(page);
    await expect(page.locator('#hotseat-overlay')).toBeVisible();
    await page.click('#hotseat-overlay');
    await expect(page.locator('.board__cell')).toHaveCount(256);
    await expect(page.locator('.board__token')).toHaveCount(4);
    await expect(page.locator('.ui__hand .card')).toHaveCount(5);
  });

  test('allows moving a wizard to a highlighted cell', async ({ page }) => {
    await page.goto('/');
    await startGame(page);
    await page.click('#hotseat-overlay');
    const highlighted = page.locator('.board__cell--highlight');
    await expect(highlighted.first()).toBeVisible();
    await highlighted.first().click();
    await expect(page.locator('.ui__logline', { hasText: 'moves' }).first()).toBeVisible();
  });

  test('flows through move-cast and discard-draw phases', async ({ page }) => {
    await page.goto('/');
    await startGame(page);
    await page.click('#hotseat-overlay');
    await page.click('.ui__phasecontrols button:has-text("End Turn")');
    await expect(page.locator('.ui__phasecontrols button:has-text("Draw 2")')).toBeVisible();
    const handBefore = await page.locator('.ui__hand .card').count();
    await page.click('.ui__phasecontrols button:has-text("Draw 2")');
    const handAfter = await page.locator('.ui__hand .card').count();
    expect(handAfter).toBeGreaterThan(handBefore);
    await page.click('.ui__phasecontrols button:has-text("Done")');
    await expect(page.locator('#hotseat-overlay')).toBeVisible({ timeout: 10000 });
  });

  test('bot plays its turn automatically', async ({ page }) => {
    await page.goto('/');
    await startGame(page);
    await page.click('#hotseat-overlay');
    await page.click('.ui__phasecontrols button:has-text("End Turn")');
    await page.click('.ui__phasecontrols button:has-text("Done")');
    await expect(page.locator('#hotseat-overlay')).toBeVisible({ timeout: 15000 });
  });
});