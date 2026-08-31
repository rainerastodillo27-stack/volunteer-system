# Proposal Revision Fix - Missing Revised Card Issue

## Problem
When a partner revised a rejected proposal, the revised submission card was not appearing in the conversation. Only the original SUBMITTED and REJECTED cards were visible.

## Root Cause
The issue was in how the `projectId` was being passed when opening a revision:

### Before (Line ~2272):
```typescript
const targetProjectId = String(cardData.targetProjectId || cardData.projectId || 'new');
setProposalIntent({
  projectId: targetProjectId,  // ❌ Wrong! Using targetProjectId first
});
```

The code was prioritizing `card Data.targetProjectId` which might be empty or point to a different project, rather than using the **application's own projectId** which the backend needs to match and increment the revision.

## Solution Applied

### Fix 1: Correct ProjectId Selection (Line ~2289)
```typescript
// IMPORTANT: Use the application's projectId (not targetProjectId) so backend can match and increment revision
const applicationProjectId = String(cardData.projectId || 'new');
```

**Why this works:**
- When a partner submits a proposal, the backend creates an application with `projectId: "program:Nutrition::1735123456789"`
- When revising, the frontend MUST send this exact same `projectId`
- The backend then matches by projectId and increments `revisionNumber` from 0 → 1
- This creates a new message card with revision 1

### Fix 2: Added Debug Logging
```typescript
console.log('🔄 Opening proposal revision:');
console.log('  - Application ID:', applicationId);
console.log('  - Project ID:', applicationProjectId);
console.log('  - Program Module:', requestedProgramModule);
```

```typescript
console.log('📤 Submitting proposal:');
console.log('  - Project ID:', proposalIntent.projectId || 'new');
console.log('  - Program Module:', proposalIntent.module);
console.log('  - Revision Mode:', proposalRevisionMode);
```

These logs help debug if the revision flow breaks in the future.

### Fix 3: Better Success Message
```typescript
const successMessage = proposalRevisionMode 
  ? 'Your revised proposal has been submitted for review.'
  : 'Your proposal has been submitted for review.';
```

## How The Flow Works Now

### 1. Partner Submits Original Proposal
- Frontend calls: `submitPartnerProgramProposal('new', user, {...})`
- Backend creates: Application with `projectId: "program:Nutrition::1735123456789"`, `revisionNumber: 0`, `status: "Pending"`
- Backend creates message card: `msg-proposal-1234567890` with revision 0
- Card key: `app123:0:submission:Pending`

### 2. Admin Rejects
- Admin clicks reject → Backend updates status to "Rejected"
- Backend creates review card: `review-card-Rejected-app123-1234567891`
- Card key: `app123:0:review:Rejected`

### 3. Partner Revises
- Partner clicks "Revise & Resubmit"
- `openProposalRevision` extracts: `projectId: "program:Nutrition::1735123456789"` ✅
- Form pre-fills with existing data

### 4. Partner Submits Revision
- Frontend calls: `submitPartnerProgramProposal('program:Nutrition::1735123456789', user, {...})`
- Backend finds existing application by matching `projectId`
- Backend updates: `revisionNumber: 0 + 1 = 1`, `status: "Pending"`, `resubmittedAt: now()`
- Backend creates NEW message card: `msg-proposal-1234567892` with revision 1
- Card key: `app123:1:submission:Pending` ✅ **NEW UNIQUE KEY!**

### 5. Cards Displayed
Partner now sees THREE cards:
1. Original submission (`app123:0:submission:Pending`)
2. Admin rejection (`app123:0:review:Rejected`)
3. Revised submission (`app123:1:submission:Pending`) ← **This was missing before!**

## Backend Matching Logic (api.py ~4151)
```python
def _application_matches_module(app: dict[str, Any]) -> bool:
    app_project_id = str(app.get("projectId") or "")
    # Exact match on the timestamped ID
    if app_project_id == requested_project_id:
        return True  # ✅ Match found!
```

## Testing Checklist

### Test Scenario 1: New Proposal
- [ ] Partner submits new proposal
- [ ] Blue "SUBMITTED" card appears
- [ ] Admin can see the proposal

### Test Scenario 2: Rejection
- [ ] Admin rejects proposal with reason
- [ ] Red "REJECTED" card appears in partner's view
- [ ] Rejection reason is displayed

### Test Scenario 3: Revision
- [ ] Partner clicks "Revise & Resubmit" on rejected card
- [ ] Form pre-fills with previous data
- [ ] Partner makes changes and submits
- [ ] **NEW blue "SUBMITTED" card appears (marked as "Revised Proposal #1")**
- [ ] All three cards visible: Original + Rejection + Revision

### Test Scenario 4: Multiple Revisions
- [ ] Admin rejects revision #1
- [ ] Partner revises again
- [ ] Revision #2 card appears
- [ ] All cards remain visible (audit trail)

### Test Scenario 5: Approval
- [ ] Admin approves a revision
- [ ] Green "APPROVED" card appears
- [ ] Partner can view their approved project
- [ ] "Revise" button no longer available

## Debug Commands

### Frontend Console
```javascript
// Check what projectId is being used
localStorage.getItem('proposalIntent')

// Check loaded messages
console.log(messages.filter(m => m.content?.includes('PROPOSAL_CARD')))
```

### Backend Logs
Look for these log entries:
```
📥 PROPOSAL REQUEST RECEIVED
  Partner User ID: partner123
  Project ID: program:Nutrition::1735123456789
  
🔄 Creating resubmission message card:
  - Message ID: msg-proposal-1735123456792
  - Revision Number: 1
  
✅ Resubmission message card created and broadcast successfully
```

## Files Modified
- `screens/CommunicationHubScreen.tsx` (Lines ~2272-2315)
  - Fixed projectId selection in `openProposalRevision()`
  - Added debug logging
  - Improved success messages

## Related Documentation
- `PROPOSAL_CARD_FLOW_FINAL.md` - Overall card flow design
- `TESTING_PROPOSAL_CARDS.md` - Manual testing guide
- `PROPOSAL_REVISION_DEBUGGING_GUIDE.md` - Debugging checklist
