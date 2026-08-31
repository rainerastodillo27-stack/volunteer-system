# Testing Proposal Card Conversation Flow

## Setup

Make sure both backend and frontend are running with the latest code.

## Test Scenario: Full Proposal Lifecycle

### Step 1: Partner Submits Initial Proposal

1. **Login as Partner**
2. Navigate to **Communication Hub** or **Program Proposals**
3. Click **Submit New Proposal**
4. Fill in all required fields:
   - Title
   - Description
   - Start Date
   - End Date
   - Location
   - Program Module
5. Click **Submit**

**Expected Result:**
- Success alert: "Your proposal has been submitted for review"
- **Check backend console** for log: `📨 Creating initial proposal submission message card`
- Within 1-2 seconds, you should see a **BLUE "SUBMITTED" card** in your conversation with admin

### Step 2: Admin Views Proposal

1. **Login as Admin**
2. Navigate to **Communication Hub** → **Proposals** tab
3. Select the partner's conversation from sidebar

**Expected Result:**
- You should see 1 **BLUE "SUBMITTED" card** from the partner
- The card shows proposal details and "View proposal details" button

### Step 3: Admin Rejects Proposal

1. While viewing the proposal as admin
2. Click **View proposal details**
3. Click **Reject** button
4. Enter rejection reason: "Please add more details about the community need"
5. Click **Submit Rejection**

**Expected Result:**
- Success alert
- **Check backend console** for log: `✅ Review card created`
- Within 1-2 seconds, you should see **2 cards** in the conversation:
  1. Original BLUE "SUBMITTED" card (from partner)
  2. New RED "REJECTED" card (from admin) with rejection reason

### Step 4: Partner Views Rejection

1. **Switch back to Partner account**
2. Navigate to **Communication Hub**
3. Open conversation with admin (should have a notification badge)

**Expected Result:**
- You should see **2 cards**:
  1. Your original BLUE "SUBMITTED" card
  2. Admin's RED "REJECTED" card with rejection reason displayed

### Step 5: Partner Revises and Resubmits

1. While viewing the rejection card
2. Click **"Revise Proposal"** or **"View proposal details"** → **"Revise"**
3. Update the proposal (e.g., add more community need details)
4. Click **Submit**

**Expected Result:**
- Success alert: "Your proposal has been submitted for review"
- **Check backend console** for log: `🔄 Creating resubmission message card` with `Revision Number: 1`
- **Check frontend console** for log: `✅ Proposal submitted successfully, refreshing messages...`
- Within 1-2 seconds, you should see **3 cards** in chronological order:
  1. Original BLUE "SUBMITTED" card (revision 0)
  2. Admin's RED "REJECTED" card (revision 0)
  3. New BLUE "SUBMITTED" card labeled as "Revised Proposal" (revision 1)

### Step 6: Admin Views Revised Proposal

1. **Switch back to Admin account**
2. Open the partner's conversation

**Expected Result:**
- You should see **3 cards**:
  1. Partner's original submission
  2. Your rejection
  3. Partner's revised submission (clearly marked)

### Step 7: Admin Approves Revised Proposal

1. Click on the revised proposal card
2. Click **Approve** button
3. Confirm approval

**Expected Result:**
- Success alert: "Proposal approved and new project created"
- Within 1-2 seconds, you should see **4 cards**:
  1. Original BLUE "SUBMITTED" (rev 0)
  2. RED "REJECTED" (rev 0)
  3. Revised BLUE "SUBMITTED" (rev 1)
  4. New GREEN "APPROVED" card (rev 1) with link to created project

### Step 8: Partner Views Approval

1. **Switch back to Partner account**
2. View conversation with admin

**Expected Result:**
- You should see **4 cards** showing the complete conversation history
- The approved project should now appear in your **Projects** list

## Debugging

### If Cards Don't Appear:

1. **Check Backend Console:**
   - Look for `📨 Creating initial proposal submission message card`
   - Look for `🔄 Creating resubmission message card`
   - Look for `✅ ... created and broadcast successfully`
   - If you see `❌ Error creating...`, check the error details

2. **Check Frontend Console:**
   - Look for `✅ Proposal submitted successfully, refreshing messages...`
   - Look for `📬 Received X proposal card(s) from backend`
   - Any error messages about failed API calls

3. **Check Database:**
   ```sql
   SELECT id, sender_id, recipient_id, 
          LEFT(content, 50) as content_preview,
          timestamp
   FROM public.messages 
   WHERE content LIKE '___PROPOSAL_CARD___%'
   ORDER BY timestamp DESC
   LIMIT 20;
   ```

4. **Check Message IDs:**
   - Submission cards should have ID format: `msg-proposal-{timestamp}`
   - Review cards should have ID format: `review-card-{status}-{appId}-{timestamp}`

5. **Common Issues:**
   - **Wrong conversation open:** Make sure you're viewing the conversation between partner and admin, not a group chat
   - **Cache not clearing:** Try refreshing the page (F5)
   - **WebSocket disconnected:** Check network tab for WebSocket connection errors
   - **Backend not running:** Ensure the Python backend is running and accessible

### Card Deduplication Test:

To verify cards aren't being incorrectly deduplicated:

1. Open browser DevTools → Console
2. After submitting a proposal, run:
   ```javascript
   // This will show you the deduplication keys
   // You should see different keys for each card
   ```
3. Check the keys follow the pattern: `{appId}:{revision}:{cardType}:{status}`
4. Each unique combination should have exactly one card

## Expected Card Colors and Icons:

- **SUBMITTED** (Partner → Admin): Blue background, send icon
- **REJECTED** (Admin → Partner): Red background, cancel icon
- **APPROVED** (Admin → Partner): Green background, check-circle icon

## Backend Logs to Monitor:

```
📨 Creating initial proposal submission message card:
  - Message ID: msg-proposal-1234567890
  - Partner ID: partner-abc
  - Application ID: partner-application-xyz

🔄 Creating resubmission message card:
  - Message ID: msg-proposal-1234567891  
  - Partner ID: partner-abc
  - Revision Number: 1

✅ Initial proposal message card created and broadcast successfully
✅ Resubmission message card created and broadcast successfully
```

## Success Criteria:

✅ Partner sees their submission cards in blue  
✅ Admin sees review cards (rejection/approval) they sent  
✅ ALL cards remain visible in chronological order  
✅ Revision number increments correctly (0, 1, 2, ...)  
✅ Rejection reason is displayed on rejection cards  
✅ No duplicate cards appear  
✅ Cards appear within 1-2 seconds of action  
