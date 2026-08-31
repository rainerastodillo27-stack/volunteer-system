# Create Revised Proposal via API (Manual Steps)

Since the database connection pool is full, here's how to manually create a revision:

## Option 1: Use the Partner Account

1. **Open the app as the Partner user** (not admin)
2. **Go to Communication Hub**
3. **Click on the REJECTED proposal card**
4. **Click "Revise & Resubmit"** button
5. **Make a small change** (e.g., add text to description)
6. **Submit**
7. **Refresh the page**
8. **You should now see TWO cards:**
   - OLD: REJECTED (with "OLDER VERSION" warning)
   - NEW: SUBMITTED - Revised Proposal #1

## Option 2: Restart Backend (Clears Connections)

1. **Stop your backend server** (Ctrl+C in the terminal)
2. **Wait 5 seconds**
3. **Start backend again**: `cd backend && python -m uvicorn api:app --reload --host 0.0.0.0 --port 8000`
4. **Wait for "Application startup complete"**
5. **Run the script**: `python create_revised_message_card.py`

## Option 3: Test Without Creating Data

The code fix is already in place! You can test it by:

1. **Go to Communication Hub as Partner**
2. **Click the REJECTED card**
3. **Click "Revise & Resubmit"**
4. **Fill out the form and submit**
5. **Switch to Admin account**
6. **Check if:**
   - ✅ OLD REJECTED card shows "OLDER VERSION" warning
   - ✅ OLD card has NO "Approve/Reject" buttons
   - ✅ NEW REVISED card appears
   - ✅ NEW card HAS "Approve/Reject" buttons

The fix is already implemented in the code - you just need to actually revise a proposal!
