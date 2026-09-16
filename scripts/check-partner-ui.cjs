// Run against a local Expo server, e.g. npx expo start --port 8097.
const { chromium, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const origin = process.env.UI_PREVIEW_URL || 'http://localhost:8097';
  mkdirSync('artifacts/screenshots/partner-ui', { recursive: true });
  try {
    for (const width of [320, 360, 390, 430, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(`${origin}/partner-ui-preview`, route => route.fulfill({
        contentType: 'text/html',
        body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%}#root{display:flex}</style></head><body><div id="root"></div><script src="/tests/ui-fixtures/partner-ui.bundle?platform=web&dev=true&hot=false"></script></body></html>',
      }));
      await page.goto(`${origin}/partner-ui-preview`);
      const card = page.getByTestId('project-upcoming-events').first();
      await expect(card).toBeVisible({ timeout: 120000 });
      await page.evaluate(() => document.fonts.ready);
      const row = page.getByTestId('upcoming-event-sample');
      const title = row.getByText('APK proposal test Event with a long project title');
      const titleBounds = await title.boundingBox();
      const cardBounds = await card.boundingBox();
      expect(titleBounds.width).toBeGreaterThan(100);
      expect(titleBounds.height).toBeLessThanOrEqual(41);
      expect(cardBounds.height).toBeLessThan(300);
      await row.getByRole('button', { name: /View APK/ }).click();
      await expect(page.getByTestId('selected-event')).toHaveText('sample');

      const reminder = page.getByTestId('event-reminder-0');
      await expect(reminder.getByRole('radio', { name: 'Email', exact: true })).toBeChecked();
      for (const name of ['Notification', 'Email', 'Minutes', 'Hours', 'Days']) {
        const choice = reminder.getByRole('radio', { name, exact: true });
        await expect(choice).toBeVisible();
        await choice.click();
        await expect(choice).toBeChecked();
        const bounds = await choice.boundingBox();
        expect(bounds.height).toBeGreaterThanOrEqual(44);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      }
      await reminder.getByRole('textbox').fill('12x');
      await expect(reminder.getByRole('textbox')).toHaveValue('12');
      await page.getByRole('button', { name: 'Add another notification' }).click();
      await expect(page.getByTestId('event-reminder-1').getByRole('radio', { name: 'Notification', exact: true })).toBeChecked();
      await expect(reminder.getByRole('radio', { name: 'Days', exact: true })).toBeChecked();
      await page.getByRole('button', { name: 'Remove reminder 2', exact: true }).click();
      await expect(page.getByTestId('event-reminder-1')).toHaveCount(0);
      const emptyCard = page.getByTestId('project-upcoming-events').nth(1);
      await expect(emptyCard).toContainText('No upcoming events scheduled.');
      expect((await emptyCard.boundingBox()).height).toBeLessThan(140);
      const manyCard = page.getByTestId('project-upcoming-events').nth(2);
      await expect(manyCard.getByTestId(/^upcoming-event-/)).toHaveCount(3);
      const summary = page.getByTestId('project-summary-card');
      const actions = page.getByTestId('project-quick-actions');
      await summary.scrollIntoViewIfNeeded();
      const summaryBounds = await summary.boundingBox();
      const columnBounds = await page.getByTestId('summary-column').boundingBox();
      const actionBounds = await actions.boundingBox();
      expect(Math.abs(summaryBounds.width - columnBounds.width)).toBeLessThan(1);
      if (width < 1100) expect(summaryBounds.width).toBe(width - 40);
      expect(summaryBounds.height).toBeLessThan(680);
      expect(actionBounds.y).toBeGreaterThanOrEqual(summaryBounds.y + summaryBounds.height + 19);
      for (const text of ['In Progress', 'Community Nutrition Program', /August 31st/, 'Alicante, Enrique B. Magalona, Negros Island Region (NIR)', 'Upload document', 'View full details']) {
        const bounds = await summary.getByText(text, { exact: typeof text === 'string' }).boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds.x).toBeGreaterThanOrEqual(summaryBounds.x);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(summaryBounds.x + summaryBounds.width);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(summaryBounds.y + summaryBounds.height);
      }
      for (const [name, value] of [['Create Event', 'create'], ['View Reports', 'reports'], ['View full details', 'details'], [/Upload document/, 'document']]) {
        await page.getByTestId('project-details-sidebar').getByRole('button', { name }).click();
        await expect(page.getByTestId('summary-action')).toHaveText(value);
      }
      await summary.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `artifacts/screenshots/partner-ui/summary-${width}.png` });
      await page.getByRole('button', { name: 'Preview event summary' }).click();
      await expect(summary).toContainText('Event Summary');
      await expect(summary).toContainText('1 / 10');
      await expect(actions.getByRole('button', { name: 'Create Event' })).toHaveCount(0);
      await actions.getByRole('button', { name: 'Attendance & Tasks' }).click();
      await expect(page.getByTestId('summary-action')).toHaveText('attendance');
      await manyCard.getByRole('button', { name: 'View all events' }).click();
      await expect(manyCard.getByTestId(/^upcoming-event-/)).toHaveCount(5);
      await manyCard.getByRole('button', { name: 'Show fewer events' }).click();
      await expect(manyCard.getByTestId(/^upcoming-event-/)).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `artifacts/screenshots/partner-ui/width-${width}.png` });
      console.log(`${width}px: event card ${Math.round(cardBounds.height)}px, summary ${Math.round(summaryBounds.height)}px; text containment, reminders and actions passed`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
