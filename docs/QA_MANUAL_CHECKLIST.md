# Volcre Manual QA Checklist (Click-by-Click)

Use this as a strict PASS/FAIL runbook for UI validation on web and mobile.

## Preflight

- [ ] Backend running (`npm run backend` or `npm run all:bg`)
- [ ] Web running (`npm run web` or `npm start`)
- [ ] Can open `http://localhost:8081`
- [ ] Can open backend health: `http://127.0.0.1:8000/health`
- [ ] Test accounts available:
  - Admin: `admin@nvc.org / admin123`
  - Volunteer: `volunteer@example.com / volunteer123`
  - Partner: `partnerships@pbsp.org.ph / partner123`

---

## A. Admin Web Flows

### A1. Admin Login
- [ ] Open web app
- [ ] Sign in with admin credentials
- [ ] Land on admin dashboard without error alerts

### A2. Create Program
- [ ] Open lifecycle/project management screen
- [ ] Click create program
- [ ] Fill Title, Description, Module, Status, Dates
- [ ] In `Place`, select Region -> City/Municipality -> Barangay
- [ ] Fill Volunteer Slots
- [ ] Click Save
- [ ] Confirm success alert (`Saved`/`Program created`)
- [ ] Confirm new program appears in project list

### A3. Edit Program
- [ ] Open created program
- [ ] Click edit
- [ ] Change at least Title/Description/Status
- [ ] Save
- [ ] Confirm success alert (`Program updated`)
- [ ] Confirm list/detail shows updated values

### A4. Create Event under Program
- [ ] Open a program
- [ ] Click create event
- [ ] Set event dates within parent project range
- [ ] Set Place with Region -> City/Municipality -> Barangay
- [ ] Save
- [ ] Confirm success alert (`Event created`)
- [ ] Confirm event is listed under parent program

### A5. Delete Program/Event
- [ ] Open target program/event
- [ ] Click delete
- [ ] Confirm deletion in dialog
- [ ] Confirm success alert (`Deleted`)
- [ ] Confirm item no longer appears

### A6. Status Update Save
- [ ] Open a project/event
- [ ] Add lifecycle/status update text
- [ ] Save status update
- [ ] Confirm success alert
- [ ] Confirm update appears in timeline/list

### A7. Internal Task CRUD
- [ ] Open project/event task board
- [ ] Create task (title, description, category, priority, skills)
- [ ] Save task
- [ ] Confirm success alert (`Internal task added`)
- [ ] Edit same task and save
- [ ] Confirm success alert (`Internal task updated`)
- [ ] Delete task and confirm removal

### A8. Approve/Reject Volunteer Join Request
- [ ] Ensure a volunteer has a pending join request to an event
- [ ] Open event volunteer requests
- [ ] Approve one pending request
- [ ] Confirm success alert (`Volunteer approved and notified`)
- [ ] Reject another pending request
- [ ] Confirm success alert (`Volunteer request rejected and volunteer notified`)

### A9. Approve/Reject Partner Proposal
- [ ] Ensure a partner submitted a proposal
- [ ] Open proposal queue
- [ ] Approve one proposal
- [ ] Confirm status becomes `Approved`
- [ ] Reject one proposal
- [ ] Confirm status becomes `Rejected`

### A10. Review Reports
- [ ] Open reports/admin reports screen
- [ ] Open one submitted report
- [ ] Approve/report-review action
- [ ] Confirm review state changes and persists after refresh

---

## B. Partner Mobile Flows

### B1. Partner Login
- [ ] Open mobile app
- [ ] Choose Partner entry role
- [ ] Sign in with partner credentials
- [ ] Land on partner dashboard

### B2. Submit Partner Proposal
- [ ] Open partner project/program management
- [ ] Submit proposal/join request
- [ ] Confirm success alert
- [ ] Confirm pending state appears in partner UI

### B3. Submit Partner Report
- [ ] Open partner reports
- [ ] Fill report form and submit
- [ ] Confirm success alert
- [ ] Confirm report appears in partner list

---

## C. Volunteer Mobile Flows

### C1. Volunteer Login
- [ ] Open mobile app
- [ ] Choose Volunteer entry role
- [ ] Sign in with volunteer credentials
- [ ] Land on volunteer dashboard

### C2. Join Event
- [ ] Open projects/events
- [ ] Select an event
- [ ] Tap join/request to join
- [ ] Confirm pending/joined state shown

### C3. Time In / Time Out
- [ ] Open joined event
- [ ] Tap Time In / Start Time Logging
- [ ] Confirm active time state appears
- [ ] Tap Time Out / Stop Time Logging
- [ ] Confirm success alert and log entry appears

### C4. Submit Volunteer Report
- [ ] Open report flow from event or reports screen
- [ ] Fill required fields and submit
- [ ] Confirm success alert
- [ ] Confirm report appears in volunteer report history

---

## D. Messaging / Chat Flows

### D1. Direct Message
- [ ] Open communication/messages
- [ ] Send message to another account
- [ ] Confirm message appears in sender thread
- [ ] Confirm receiver sees message

### D2. Project Group Chat
- [ ] Open a project/event group chat
- [ ] Send group message
- [ ] Confirm message appears immediately
- [ ] Refresh/reopen and confirm message persists

---

## E. Mapping / Location Display

### E1. Program/Event Map Card
- [ ] Open mapping screen
- [ ] Select a created program/event
- [ ] Confirm map pin appears
- [ ] Confirm displayed address matches selected Region/City/Barangay

---

## Result Summary

- Total checks: 53
- Passed: ___
- Failed: ___
- Run date/time: ___
- Tester: ___
- Notes / blockers:
  - ___
