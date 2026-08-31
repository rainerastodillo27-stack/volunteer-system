# Proposal Card Conversation History Fix

## Problem

The system was only showing **ONE card** when it should show the **full conversation history** of a proposal:
1. Partner's original submission
2. Admin's rejection notice (with rejection reason)
3. Partner's revised submission
4. Admin's approval

### Root Cause

The system had a **reconciliation function** (`_reconcile_partner_proposal_submission_cards`) that **merged** the partner's submission card with the admin's review card, overwriting the original submission card. This meant you only saw the final state, not the conversation.

## Solution

Modified the system to **preserve all cards** as separate messages to create a full conversation history.

### Changes Made

#### 1. Backend API (`backend/api.py`)

**Changed:** Review endpoint no longer reconciles/merges cards
- **Line ~4505**: Modified review card creation to include `revisionNumber` in the card data
- **Line ~4508**: Changed message ID format to include application ID: `review-card-{status}-{appId}-{timestamp}`
- **Line ~4557**: **Commented out** the reconciliation call that was merging cards

**Result:** Each action (submit, reject, resubmit, approve) now creates a **separate, immutable card**.

#### 2. Frontend Deduplication Logic (`screens/CommunicationHubScreen.tsx`)

**Changed:** Updated `getProposalReviewCardKey()` to distinguish between submission and review cards

**Old Key Format:** `applicationId:revisionNumber:status`
- This would treat a submission with status "Pending" and a review changing it to "Rejected" as the same card

**New Key Format:** `applicationId:revisionNumber:cardType:status`
- `cardType` is either `'submission'` (partner sent) or `'review'` (admin sent)
- Now each card type gets its own entry in the conversation

**Lines ~251-280**: Added logic to determine card type from message ID:
- `msg-proposal-*` = submission card (from partner)
- `review-card-*` = review card (from admin)

#### 3. Card Removal Logic (`screens/CommunicationHubScreen.tsx`)

**Changed:** Removed code that updated existing message cards with new status

**Lines ~2167-2177**: **Commented out** the code that was finding and updating old cards when a review happened
- Old behavior: When admin rejects, find the submission card and update its status to "Rejected"
- New behavior: Let the backend create a new review card, don't touch the submission card

**Lines ~2203-2234**: **Removed** the code that was sending duplicate rejection cards via `sendGroupMessage`

#### 4. Card Display Logic (`screens/CommunicationHubScreen.tsx`)

**Changed:** Different visual treatment for submission vs review cards

**Lines ~3839-3896**: Added logic to display cards differently based on type:

**Submission Cards** (from partner):
- Badge: "SUBMITTED" (blue background)
- Icon: send icon
- Message: "Your proposal for X has been submitted for review"
- OR "Your revised proposal for X has been submitted for review" (if revision > 0)

**Review Cards** (from admin):
- Badge: "APPROVED" (green) or "REJECTED" (red)
- Icon: check-circle or cancel
- Message: "Your proposal for X has been reviewed and has been approved/needs changes"

## Expected Flow Now

### Scenario: Partner submits → Admin rejects → Partner revises → Admin approves

**Cards that will appear in chronological order:**

1. **Card 1 - Submission** (from partner, blue "SUBMITTED")
   - ID: `msg-proposal-1234567890`
   - Key: `app-123:0:submission:Pending`
   - Message: "Your proposal for 'Nutrition' has been submitted for review"

2. **Card 2 - Rejection** (from admin, red "REJECTED")
   - ID: `review-card-rejected-app-123-1234567891`
   - Key: `app-123:0:review:Rejected`
   - Message: "Your proposal for 'Nutrition' has been reviewed and needs changes"
   - Shows rejection reason

3. **Card 3 - Resubmission** (from partner, blue "SUBMITTED")
   - ID: `msg-proposal-1234567892`
   - Key: `app-123:1:submission:Pending`
   - Message: "Your revised proposal for 'Nutrition' has been submitted for review"

4. **Card 4 - Approval** (from admin, green "APPROVED")
   - ID: `review-card-approved-app-123-1234567893`
   - Key: `app-123:1:review:Approved`
   - Message: "Your proposal for 'Nutrition' has been reviewed and has been approved"

## Testing

To verify the fix works:

1. **Partner** submits a new proposal
   - Should see 1 blue "SUBMITTED" card

2. **Admin** rejects it with a reason
   - Should see 2 cards: blue "SUBMITTED" + red "REJECTED" (with rejection reason)

3. **Partner** revises and resubmits
   - Should see 3 cards: original submission + rejection + new blue "SUBMITTED" (marked as revised)

4. **Admin** approves the revision
   - Should see 4 cards: original + rejection + revised submission + green "APPROVED"

## Benefits

✅ **Full conversation history** - Partners can see the complete journey of their proposal
✅ **Clear communication** - Each action (submit, reject, revise, approve) is a separate card
✅ **No data loss** - Original submissions are never overwritten
✅ **Better UX** - Partners can refer back to rejection reasons even after resubmitting
✅ **Audit trail** - Complete record of all proposal interactions

## Migration Note

Existing proposals that were already reconciled (merged) will continue to show as single cards. Only new proposals going through the flow will show the full conversation history.

If you need to migrate old proposals, you would need to:
1. Parse the reconciled cards to extract original submission data
2. Create separate submission and review cards
3. Re-insert them with proper IDs and timestamps

However, this is optional - the system will work correctly for all new proposals without any migration.
