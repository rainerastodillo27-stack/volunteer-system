# System Process Flow Guide

This document explains the connected process flow for all user roles in the volunteer system.

## 1. User Roles

- `Admin`: manages user approval, project approval, volunteer requests, project lifecycle, reports, and published impact outputs.
- `Volunteer`: registers, waits for approval, joins projects, times in and out, and submits reports.
- `Partner`: registers an organization, waits for approval, proposes projects, checks in on-site, submits reports, and downloads published impact files.

## 2. Account Registration and Approval

### Volunteer

1. The volunteer signs up.
2. The system creates:
   - a `User` account with `approvalStatus: pending`
   - a linked `Volunteer` profile with `registrationStatus: Pending`
3. Admin reviews the request in `User Management`.
4. When admin approves or rejects the volunteer, both the account and the volunteer profile are updated together.
5. The volunteer can log in only after approval.

### Partner

1. The partner signs up.
2. The system creates:
   - a `User` account with `approvalStatus: pending`
   - a linked `Partner` organization record with `status: Pending`
3. Admin reviews the request in `User Management`.
4. When admin approves or rejects the partner, both the account and the partner record are updated together.
5. The partner can log in only after approval.

## 3. Volunteer Project Flow

### Join Request

1. The volunteer opens `Projects`.
2. The volunteer taps `Request to Join`.
3. The system stores a volunteer join request as `Requested`.
4. Admin sees the request in `Project Lifecycle`.
5. Admin approves or rejects the request.
6. When approved:
   - the volunteer is added to the project
   - a join record is created
   - the volunteer can use project participation actions

### Time In and Time Out

1. An approved volunteer taps `Time In`.
2. The system creates an active time log.
3. Before `Time Out`, the volunteer must provide at least one proof:
   - a short completion report
   - a completion photo
4. When the volunteer taps `Time Out`, the system:
   - closes the time log
   - adds the hours to the volunteer profile
   - keeps the proof on the time log
   - automatically sends the completion report to `Reports`

### Volunteer Reports

- Volunteers can also submit reports manually from the `Reports` screen.
- Timeout-generated reports and manual reports go to the same report storage.
- Reports are direct submissions and do not need admin approval.

## 4. Partner Project Flow

### Partner Proposal

1. An approved partner opens `Projects` or `Partner Dashboard`.
2. The partner submits a project proposal.
3. The system stores the proposal as `Pending`.
4. Admin reviews it in `Project Lifecycle`.
5. Admin approves or rejects it.
6. When approved, the partner gains access to that project's partner actions.

### Partner Check-In

1. The partner opens an approved project.
2. The partner taps `Check-In`.
3. The system captures the coordinates and stores the field activity entry.
4. The check-in history appears on the partner dashboard.

### Partner Reports

1. The partner fills out the project report form.
2. The partner submits:
   - report type
   - description
   - impact count
   - optional photo
3. The system stores the report in the shared reports data.
4. The report appears in:
   - the partner dashboard history
   - the `Reports` screen
   - the admin project lifecycle report list

### Important Rule

- Partner reports go directly to `Reports`.
- There is no admin approve or reject step for reports.

## 5. Admin Project Lifecycle Flow

Admin uses `Project Lifecycle` to manage the connected project process.

### Admin actions

- create and edit projects
- update project status
- assign tasks
- approve or reject partner proposals
- approve or reject volunteer join requests
- view volunteer time logs
- view submitted reports
- generate final impact files
- publish final impact files to partner access

### Volunteer completion tracking

When admin marks a volunteer as completed:

- the join record becomes `Completed`
- the volunteer match becomes `Completed`
- the project is added to volunteer history
- the volunteer engagement status is recalculated

## 6. Reports Flow

The reports process is submission-based.

### Reports can come from

- volunteer manual report upload
- volunteer timeout auto-report
- partner manual report upload

### Reports are visible in

- `Reports` screen
- admin reports dashboard
- partner dashboard history
- project lifecycle report list

### Report media

- attached photos are visible in report details
- volunteer timeout proof photos are included in report details

## 7. Published Impact File Flow

1. Admin generates final impact files in `Project Lifecycle`.
2. The system now creates readable export content from the submitted project reports.
3. Admin publishes the generated file entry.
4. Approved partners can access the published file from the partner dashboard.
5. On web, the partner can download a readable text or CSV export for the published file.

## 8. Messaging and Notifications

The system sends internal notifications for important approval actions.

### Admin receives messages when

- a volunteer requests to join a project
- a partner submits a project proposal

### Volunteer receives messages when

- a join request is approved
- a join request is rejected
- the admin directly assigns the volunteer to a project

### Partner receives messages when

- a project proposal is approved
- a project proposal is rejected

## 9. Data Integrity

When admin deletes a user, the system now also removes linked data so records do not stay orphaned.

Linked cleanup includes:

- volunteer profile
- partner organization owned by that user
- volunteer join records
- volunteer matches
- volunteer time logs
- partner applications
- partner check-ins
- partner reports
- project membership references
- user messages

## 10. End-to-End Connected Flows

### Volunteer

Sign up -> admin approval -> login -> request project join -> admin approval -> time in -> time out with proof -> report appears in `Reports`

### Partner

Sign up -> admin approval -> login -> submit project proposal -> admin approval -> check in -> upload report -> report appears in `Reports` -> download published impact file

### Admin

Review accounts -> manage projects -> review volunteer and partner requests -> monitor reports and time logs -> generate and publish final impact files

## 11. Current Rules Summary

- Account approval stays synced across linked user records.
- Volunteer time out requires proof before sign-out.
- Volunteer timeout proof is sent automatically to `Reports`.
- Partner reports go straight to `Reports`.
- Reports do not need admin approval.
- Published impact files are the final admin-to-partner output.
