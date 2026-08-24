// E2E: React AI battle smoke test — setup → start → board renders → game runs.
import { test, expect } from '@playwright/test';

test('AI battle runs in the React UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.setup')).toBeVisible({ timeout: 10000 });

  // Pick 3 schools and start an AI vs AI game.
  const boxes = page.locator('.setup-school input');
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await page.locator('.setup-start').click();

  // Board renders with 100 cells and 4 wizard tokens.
  await expect(page.locator('.board-cell')).toHaveCount(100, { timeout: 15000 });
  expect(await page.locator('.token').count()).toBe(4);

  // The game actually progresses: log grows over a few seconds.
  await page.waitForTimeout(4000);
  const logLineCount = await page.locator('.log-line').count();
  expect(logLineCount).toBeGreaterThan(5);
  await expect(page.locator('.player-panel')).toHaveCount(4);
});

test('human vs AI shows interactive controls', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.setup')).toBeVisible({ timeout: 10000 });

  // Switch mode to Human vs AI, pick schools, start.
  await page.locator('.setup-row').nth(1).locator('select').selectOption('human');
  const boxes = page.locator('.setup-school input');
  for (let i = 0; i < 3; i++) await boxes.nth(i).check();
  await page.locator('.setup-start').click();

  // Human turn appears: hand label marks the player + "(You)", and move cells highlight.
  await expect(page.locator('.hand-label')).toContainText('Wizard\'s Hand (You)', { timeout: 15000 });
  const moveCells = await page.locator('.board-cell--hl-move').count();
  expect(moveCells).toBeGreaterThanOrEqual(1);
});
