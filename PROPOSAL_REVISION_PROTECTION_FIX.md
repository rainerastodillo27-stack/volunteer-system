# Proposal Revision Protection Fix

## Problem Identified
When a partner revised a rejected proposal:
1. ✅ Partner could see both REJECTED and REVISED cards (correct)
2. ❌ **Admin could still approve the OLD REJECTED card** (WRONG!)
3. ❌ The old REJECTED card still showed "Approve/Reject" buttons

This was dangerous because an admin might accidentally approve an outdated version instead of reviewing the latest revision.

## Solution Implemented

### Fix 1: Detection of Superseded Proposals (Line ~4403)
Added logic to detect when a proposal card represents an OLD version that has been superseded by a revision:

```typescript
// Check if there's a newer revision of this proposal
const currentRevision = pd.revisionNumber || matchedApp?.revisionNumber || 0;
const applicationId = pd.applicationId || pd.id || matchedApp?.id;
const hasNewerRevision = proposalChats.some(item => {
  const app = item.application;
  const appId = app.id;
  const appProjectId = app.projectId;
  const matchesApp = appId === applicationId || appProjectId === (pd.projectId || matchedApp?.projectId);
  const appRevision = app.revisionNumber || 0;
  return matchesApp && appRevision > currentRevision;
});
```

**How it works:**
- Compares the current card's `revisionNumber` with all other proposals
- If any proposal has the same application/project ID but a HIGHER revision number → this is an old version

### Fix 2: Disable Actions on Superseded Versions (Line ~4432)
Modified the action button logic to check for superseded versions:

```typescript
const isActuallyPending = actualStatus === 'Pending' && !hasNewerRevision;
const canReviseProposal = user?.role === 'partner' && actualStatus === 'Rejected' && !hasNewerRevision;
```

**Result:**
- Admin's "Approve/Reject" buttons only show if `isActuallyPending === true`
- Partner's "Revise & Resubmit" button only shows if `canReviseProposal === true`
- If `hasNewerRevision === true` → Only "Close" button shows

### Fix 3: Visual Warning for Old Versions (Line ~4568)
Added a prominent warning banner when viewing an outdated version:

```typescript
{hasNewerRevision ? (
  <View style={{ /* yellow warning banner */ }}>
    <MaterialIcons name="info" size={16} color="#d97706" />
    <Text>OLDER VERSION</Text>
    <Text>This is an older version. A revised proposal has been submitted.</Text>
  </View>
) : null}
```

## User Experience Flow

### Scenario: Partner Revises a Rejected Proposal

#### Step 1: Admin Rejects Original
- Partner sees: SUBMITTED card → changes to REJECTED card
- Card shows: "Revise & Resubmit" button ✅

#### Step 2: Partner Revises
- Partner clicks "Revise & Resubmit"
- Makes changes and submits
- **NEW card appears:** "Revised Proposal #1 - SUBMITTED" ✅

#### Step 3: Cards Now Show
Partner sees 2 cards:
1. **OLD**: REJECTED (revision 0)
   - Shows yellow "OLDER VERSION" warning ⚠️
   - Shows only "Close" button (no "Revise & Resubmit") ✅
2. **NEW**: SUBMITTED (revision 1)
   - No warning
   - Can be viewed normally

Admin sees 2 cards:
1. **OLD**: REJECTED (revision 0)
   - Shows yellow "OLDER VERSION" warning ⚠️
   - Shows only "Close" button (NO "Approve/Reject") ✅
2. **NEW**: SUBMITTED (revision 1)
   - No warning
   - Shows "Approve/Reject" buttons ✅

## Edge Cases Handled

### Multiple Revisions
If partner revises multiple times:
- Revision 0: REJECTED → Shows "OLDER VERSION" warning
- Revision 1: REJECTED → Shows "OLDER VERSION" warning
- Revision 2: PENDING → Shows action buttons (latest)

### Matching Logic
The code matches proposals by TWO criteria:
1. Application ID (`app.id === applicationId`)
2. Project ID (`app.projectId === pd.projectId`)

This ensures matching works even if IDs are stored inconsistently.

### Status Preservation
Old cards keep their status display (REJECTED, APPROVED, etc.) but lose interactivity. This preserves the conversation history while preventing accidental actions on outdated versions.

## Testing Checklist

### Test 1: Fresh Rejection
- [ ] Partner submits proposal
- [ ] Admin rejects
- [ ] Partner sees "Revise & Resubmit" button on REJECTED card

### Test 2: After Revision Submitted
- [ ] Partner revises and submits
- [ ] OLD REJECTED card now shows "OLDER VERSION" warning
- [ ] OLD card has NO "Revise & Resubmit" button
- [ ] NEW SUBMITTED card shows normally (no warning)

### Test 3: Admin Cannot Review Old Version
- [ ] Admin opens OLD REJECTED card
- [ ] Sees "OLDER VERSION" warning
- [ ] Does NOT see "Approve/Reject" buttons
- [ ] Only sees "Close" button

### Test 4: Admin Can Review New Version
- [ ] Admin opens NEW SUBMITTED card
- [ ] No warning shown
- [ ] "Approve/Reject" buttons are visible
- [ ] Can successfully approve or reject

### Test 5: Multiple Revisions
- [ ] Partner revises multiple times (create revision 2, 3, etc.)
- [ ] All old versions show "OLDER VERSION" warning
- [ ] Only the LATEST version is actionable

## Files Modified
- `screens/CommunicationHubScreen.tsx`
  - Lines ~4403-4415: Added `hasNewerRevision` detection logic
  - Line ~4432-4433: Updated `isActuallyPending` and `canReviseProposal` conditions
  - Lines ~4568-4580: Added visual "OLDER VERSION" warning

## Security Implications
✅ **Prevents admin from accidentally approving outdated proposals**
✅ **Prevents partner from re-revising old rejected versions**
✅ **Maintains audit trail while protecting data integrity**

## Related Documentation
- `PROPOSAL_REVISION_FIX.md` - Previous fix for projectId matching
- `PROPOSAL_CARD_FLOW_FINAL.md` - Overall card flow design
- `TESTING_PROPOSAL_CARDS.md` - Manual testing procedures
