/**
 * Proposal Card Display Test
 * 
 * Verifies that proposal cards sent by partners appear in admin's Messages tab
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, waitForPageReady, clickNav } from '../helpers/ui.helper';
import { ADMIN } from '../helpers/data.helper';

test('PROP-1: TEST TEST project proposal card displays in admin messages', async ({ page }) => {
  // Login as admin
  await loginAsAdmin(page, ADMIN.email, ADMIN.password);
  await waitForPageReady(page);
  
  // Navigate to Messages
  await clickNav(page, 'Messages');
  await page.waitForTimeout(2000);
  
  // Take screenshot of messages list
  await page.screenshot({ path: 'test-results/messages-list.png', fullPage: true });
  console.log('📸 Screenshot 1: Messages list');
  
  // Click on Test contact (partner role)
  const testContact = page.locator('div').filter({ hasText: /^Test$/i }).and(page.locator('[role="button"]')).first();
  await testContact.click();
  await page.waitForTimeout(3000);
  
  // Take screenshot of conversation
  await page.screenshot({ path: 'test-results/test-conversation.png', fullPage: true });
  console.log('📸 Screenshot 2: Test conversation');
  
  // Check if the TEST TEST project card is visible
  const proposalCardTitle = page.getByText('TEST TEST project');
  
  try {
    await expect(proposalCardTitle).toBeVisible({ timeout: 10000 });
    console.log('✅ TEST TEST project card is visible!');
    
    // Check if PROPOSAL text exists
    const proposalText = page.getByText(/PROPOSAL.*PENDING/i);
    await expect(proposalText).toBeVisible({ timeout: 5000 });
    console.log('✅ Proposal status visible');
    
    // Take final screenshot
    await page.screenshot({ path: 'test-results/proposal-card-SUCCESS.png', fullPage: true });
    console.log('✅✅✅ TEST PASSED - Card is displaying!');
    
  } catch (error) {
    // Take screenshot of failure
    await page.screenshot({ path: 'test-results/proposal-card-FAILURE.png', fullPage: true });
    console.log('❌ TEST FAILED - Card not found');
    console.log('Error:', (error as any).message);
    throw error;
  }
});
