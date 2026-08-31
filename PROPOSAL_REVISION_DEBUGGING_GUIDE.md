# Proposal Revision Not Sending Card - Debugging Guide

## Issue

When you revised a rejected proposal, the new submission card did not appear in the conversation.

## Root Cause Investigation

The system has been modified to create **separate cards** for each action:
1. ✅ Partner submits → Blue "SUBMITTED" card
2. ✅ Admin rejects → Red "REJECTED" card  
3. ❌ Partner revises → Should create new Blue "SUBMITTED" card (NOT APPEARING)
4. Admin approves → Green "APPROVED" card

## What Should Happen When Revising

### Backend Flow (`backend/api.py`)

1. **Endpoint Hit:** `/partner-project-applications/request` (POST)
2. **Finds existing rejected application** by matching `projectId` or `programModule`
3. **Updates application record:**
   - Status: `Pending`
   - Revision Number: `previous + 1`
   - Clears `reviewNotes`, `reviewedBy`, `reviewedAt`
4. **Creates message card:**
   - Message ID: `msg-proposal-{timestamp}`
   - Sender: Partner user ID
   - Recipient: Admin ID
   - Content: Full application JSON with new revision number
5. **Broadcasts via WebSocket**
6. **Logs to console:**
   ```
   🔄 Creating resubmission message card:
     - Message ID: msg-proposal-1234567890
     - Partner ID: partner-xyz
     - Revision Number: 1
   ✅ Resubmission message card created and broadcast successfully
   ```

### Frontend Flow (`screens/CommunicationHubScreen.tsx`)

1. **User clicks "Revise Proposal"** → Opens form with pre-filled data
2. **User clicks "Submit"** → Calls `handleSubmitProposal()`
3. **API call:** `submitPartnerProgramProposal()` → Backend endpoint
4. **Success alert** shown
5. **Calls `loadData(false)`** to refresh messages
6. **Polling mechanism** fetches messages every 1 second via `getConversation()`
7. **New card appears** within 1-2 seconds

## Diagnostic Steps

### Step 1: Check if Backend Receives the Request

**Watch backend console when you click Submit:**

```
============================================================
📥 PROPOSAL REQUEST RECEIVED
  Partner User ID: partner-abc-123
  Partner Name: Test Partner
  Project ID: program:Nutrition::1234567890
  Program Module: Nutrition
============================================================
```

**If you DON'T see this:**
- ✗ Frontend is not calling the API
- Check browser Network tab for failed requests
- Check if `submitPartnerProgramProposal()` is being called

**If you DO see this:**
- ✓ Backend is receiving the request
- Continue to Step 2

### Step 2: Check if Backend Finds Existing Application

**Look for this log:**

```
🔄 Creating resubmission message card:
  - Message ID: msg-proposal-1234567891
  - Partner ID: partner-abc-123
  - Revision Number: 1
  - Admin ID: admin-xyz-456
```

**If you DON'T see this:**
- ✗ Backend is not identifying this as a resubmission
- It might be creating a NEW application instead (revision 0)
- Check the application matching logic
- Verify `projectId` or `programModule` matches the rejected application

**If you see "Creating initial proposal submission message card" instead:**
- ✗ Backend thinks this is a brand new proposal
- The `_application_matches_module()` function is not finding the rejected application

### Step 3: Check if Message Card is Created

**Look for this log:**

```
✅ Resubmission message card created and broadcast successfully
```

**If you see this but also see an error before it:**
```
❌ Error creating proposal resubmission message: [error details]
```
- ✗ Message creation failed
- Check the error details
- Common issues:
  - Database connection error
  - Invalid user IDs (partner or admin)
  - JSON serialization error

### Step 4: Check if Frontend Receives the Card

**Watch browser console:**

```
✅ Proposal submitted successfully, refreshing messages...
📬 Received 3 proposal card(s) from backend for conversation partner-abc-123 ↔ admin-xyz-456
```

**If you see "Received 3 proposal cards":**
- ✓ Frontend fetched the new card from backend
- The card should be visible
- If not visible, check the deduplication logic

**If you see "Received 2 proposal cards" (same count as before):**
- ✗ Frontend is not getting the new card
- Check the `/messages/conversation` API endpoint
- Verify the message was actually saved to database

### Step 5: Check Database Directly

```sql
-- Find all proposal cards for a specific partner-admin conversation
SELECT 
  id,
  sender_id,
  recipient_id,
  LEFT(content, 100) as content_preview,
  timestamp,
  CASE 
    WHEN id LIKE 'msg-proposal-%' THEN 'SUBMISSION'
    WHEN id LIKE 'review-card-%' THEN 'REVIEW'
    ELSE 'OTHER'
  END as card_type
FROM public.messages 
WHERE content LIKE '___PROPOSAL_CARD___%'
  AND (
    (sender_id = 'partner-abc-123' AND recipient_id = 'admin-xyz-456')
    OR (sender_id = 'admin-xyz-456' AND recipient_id = 'partner-abc-123')
  )
ORDER BY timestamp ASC;
```

**Expected result after revision:**
| id | card_type | timestamp | 
|----|-----------|-----------|
| msg-proposal-1001 | SUBMISSION | 2026-08-31 08:00:00 | (rev 0, original)
| review-card-rejected-... | REVIEW | 2026-08-31 08:20:00 | (rev 0, rejection)
| msg-proposal-1002 | SUBMISSION | 2026-08-31 08:30:00 | (rev 1, revised) ← THIS ONE SHOULD EXIST

**If the third row is missing:**
- ✗ Message was never inserted into database
- Check backend logs for database errors
- Check if `msg_connection.commit()` succeeded

## Common Failure Scenarios

### Scenario A: Backend Not Hit
**Symptoms:** No backend logs at all  
**Cause:** Frontend API call failing  
**Fix:** Check Network tab, verify endpoint URL, check authentication

### Scenario B: Wrong Application Matched
**Symptoms:** Backend creates new application instead of updating existing  
**Cause:** `_application_matches_module()` not finding rejected application  
**Fix:** 
- Check `projectId` value being sent
- Verify rejected application exists in `partnerProjectApplications` table
- Check matching logic in lines 4120-4158 of `backend/api.py`

### Scenario C: Message Creation Fails
**Symptoms:** Backend logs show error during message creation  
**Cause:** Database error, invalid user IDs, or JSON serialization issue  
**Fix:** Check the specific error in logs and traceback

### Scenario D: Message Created But Not Fetched
**Symptoms:** Backend succeeds, database has the message, but frontend doesn't show it  
**Cause:** API endpoint not returning the message, or caching issue  
**Fix:**
- Clear all caches: `invalidateMessageCache()`
- Check `/messages/conversation` API response
- Verify WebSocket connection is active

### Scenario E: Message Fetched But Deduplicated
**Symptoms:** Frontend receives the message but it doesn't appear in UI  
**Cause:** Deduplication logic incorrectly filtering it out  
**Fix:** 
- Check `getProposalReviewCardKey()` returns unique keys
- Expected key format: `{appId}::{revisionNumber}:{cardType}:{status}`
- Verify revision number is incrementing

## Quick Fix Checklist

When a revised proposal doesn't show a card:

1. ☐ Open browser DevTools → Console
2. ☐ Open backend terminal with logs visible
3. ☐ Click "Revise Proposal" and submit
4. ☐ Check backend for `📥 PROPOSAL REQUEST RECEIVED`
5. ☐ Check backend for `🔄 Creating resubmission message card`
6. ☐ Check backend for `✅ Resubmission message card created`
7. ☐ Check browser console for `✅ Proposal submitted successfully`
8. ☐ Check browser console for `📬 Received X proposal cards`
9. ☐ Wait 1-2 seconds for polling to fetch new card
10. ☐ If still not visible, check database with SQL query above

## Manual Trigger Message Refresh

If the card exists in database but isn't showing, you can manually trigger a refresh:

1. **In browser console:**
   ```javascript
   // Force refresh of messages
   window.location.reload();
   ```

2. **Or navigate away and back:**
   - Click on another conversation
   - Click back to the partner-admin conversation
   - This will re-fetch all messages

## Expected Timeline

- **T+0ms:** User clicks Submit
- **T+50ms:** API request sent to backend
- **T+200ms:** Backend creates message card and saves to database
- **T+250ms:** Backend broadcasts via WebSocket
- **T+300ms:** Frontend success alert shown
- **T+400ms:** `loadData()` starts fetching messages
- **T+600ms:** New card data received from backend
- **T+700ms:** Card rendered in UI

**Total: Card should appear within 1 second**

## Testing Locally

To test the full flow:

1. Start backend with logs visible
2. Start frontend with console open
3. Create a proposal as partner
4. Reject it as admin
5. Revise it as partner ← **WATCH THE LOGS HERE**
6. Verify 3 cards appear

## Still Not Working?

If none of the above helps:

1. **Share backend logs** (the section from when you click Submit)
2. **Share browser console logs**
3. **Share SQL query result** showing messages in database
4. **Share screenshot** of what cards you're seeing

This will help identify exactly where the flow is breaking.
