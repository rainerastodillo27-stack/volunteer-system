# NVC System Sitemap

This is a high-level sitemap for the NVC volunteer-management system. Use the top-level branches as the main sections of the drawing, then connect the workflow arrows between roles.

Visual version: [Open the sitemap drawing](system-sitemap.svg)

## 1. System entry

```text
NVC System
├── Public / Authentication
│   ├── Login
│   │   ├── Email, username, or phone + password
│   │   ├── Sign in with Google
│   │   ├── Sign up
│   │   │   ├── Choose account type
│   │   │   │   ├── Volunteer
│   │   │   │   └── Partner organization
│   │   │   ├── Email verification / OTP
│   │   │   ├── Volunteer registration
│   │   │   │   ├── Personal information
│   │   │   │   ├── Location and address
│   │   │   │   ├── Skills, pillars, and commitment
│   │   │   │   └── Valid ID and certification uploads
│   │   │   └── Partner registration
│   │   │       ├── Organization information
│   │   │       ├── Contact and location
│   │   │       └── Registration/accreditation document uploads
│   │   ├── Forgot password
│   │   │   ├── Request reset code
│   │   │   ├── Verify code
│   │   │   └── Set new password
│   │   └── Backend connection settings
│   └── Authenticated Main
│       └── Role dispatcher
│           ├── Admin Portal
│           ├── Volunteer Portal
│           └── Partner Portal
```

## 2. Admin portal

```text
Admin Portal
├── Dashboard
│   ├── Google Calendar sync
│   ├── Event calendar
│   ├── Upcoming events
│   ├── Recent activity
│   ├── Volunteer overview
│   ├── Analytics overview
│   └── Add project
├── Programs
│   └── Project workspace
├── All Projects
│   └── Project workspace
├── Calendar
│   └── Event/project calendar view
├── Volunteers
│   ├── Volunteer applications
│   ├── Approve or reject applications
│   ├── Volunteer profiles
│   ├── Documents and certifications
│   ├── Availability and skills
│   ├── Assign volunteers to projects/events
│   └── Volunteer reports
├── Partners
│   ├── Partner applications
│   ├── Approve or reject organizations
│   ├── Partner profiles and documents
│   ├── Collaboration management
│   └── Partner projects
├── Impact Map
│   ├── Project/event pins
│   ├── Map filters
│   └── Project/event details
├── Messages
│   ├── Contacts
│   ├── Direct conversations
│   ├── Attachments and media
│   └── Related profile/project links
├── Analytics
│   ├── Volunteer metrics
│   ├── Program/project metrics
│   ├── Event metrics
│   ├── Charts and summaries
│   └── Generate/export reports
├── Reports
│   ├── Report list/dashboard
│   ├── Report submissions and uploads
│   ├── Report details
│   ├── Project/event/attendance metrics
│   └── Download/export
├── User Management
│   ├── Search and filter users
│   ├── User/account summary
│   ├── View account details
│   ├── Edit role and account details
│   ├── Reset/change password
│   └── Delete account
├── Profile
│   ├── View account and registration details
│   ├── Edit profile
│   ├── Change password
│   └── Logout
└── Settings
    ├── In-app notifications
    ├── Backend connection/status
    ├── Account/session
    └── Logout
```

## 3. Volunteer portal

```text
Volunteer Portal
├── Home
│   ├── Welcome/overview
│   ├── Notifications
│   └── Browse events
├── Dashboard
│   ├── Volunteer summary
│   ├── Activity
│   ├── Assignments
│   └── Notifications/messages
├── Programs
│   ├── Browse programs/projects
│   ├── Search and filter
│   └── Open project details
├── Events
│   ├── Browse/search events
│   ├── Filters and sorting
│   ├── Google Calendar events
│   ├── View event/project details
│   ├── Apply/request to join
│   └── View application/joined status
├── Tasks
│   ├── Assigned events
│   ├── Assigned tasks
│   ├── Task requirements and skills
│   ├── Task status
│   ├── Attendance/photo submissions
│   └── Field activity/reporting
├── Impact Map
│   ├── Project/event pins
│   ├── Map filters
│   └── Project/event details
├── Messages
│   ├── Contacts
│   ├── Direct conversations
│   ├── Attachments and media
│   └── Related profile/project links
├── Reports
│   ├── View reports
│   ├── Submit/upload reports
│   ├── Report details
│   └── Project/event/attendance information
├── Project Details
│   ├── Project overview
│   ├── Events and tasks
│   ├── Requirements
│   └── Application/join flow
└── Profile
    ├── Personal/account details
    ├── Registration details
    ├── Skills, certifications, and affiliations
    ├── Location and address
    ├── Valid ID/document previews
    ├── Personal impact map
    ├── Edit profile
    ├── Change password
    └── Logout
```

## 4. Partner portal

```text
Partner Portal
├── Home
│   ├── Partner space and mission
│   ├── Recognition/program information
│   ├── Browse programs
│   └── Submit proposal
├── Dashboard
│   ├── Partner summary
│   ├── Project/proposal status
│   └── Open proposal management
├── Programs
│   ├── Program management
│   ├── Project calendar
│   ├── Review projects and milestones
│   └── Start a proposal
├── My Projects
│   ├── Project list
│   ├── Project metrics
│   ├── Event information
│   └── Open project workspace
├── Project Workspace
│   ├── Project overview/details
│   ├── Create/edit projects and events
│   ├── Volunteer requirements
│   ├── Volunteer applications
│   ├── Tasks and assignments
│   ├── Attendance
│   ├── Reports and outcomes
│   └── Project attachments/documents
├── Impact Map
│   ├── Project/event pins
│   ├── Map filters
│   └── Project/event details
├── Messages
│   ├── Contacts
│   ├── Direct conversations
│   ├── New project proposal
│   ├── Attachments and media
│   └── Related project/profile links
├── Reports
│   ├── View reports
│   ├── Submit/upload reports
│   ├── Report details
│   └── Project/event/attendance information
└── Profile
    ├── Organization/account details
    ├── Registration and accreditation details
    ├── Contact/location details
    ├── Document previews
    ├── Edit profile
    ├── Change password
    └── Logout
```

## 5. Main cross-role workflows

Draw these as arrows between the role sections:

```text
Volunteer
  └── Sign up
      └── Pending volunteer application
          └── Admin reviews documents/profile
              ├── Reject / request changes
              └── Approve
                  └── Volunteer accesses portal
                      ├── Browse programs and events
                      ├── Apply/join an event
                      ├── Admin/partner reviews application
                      ├── Receive project/task assignment
                      ├── Complete tasks and attendance
                      └── Submit reports/photos

Partner
  └── Sign up
      └── Pending partner application
          └── Admin reviews organization/documents
              ├── Reject / request changes
              └── Approve
                  └── Partner accesses portal
                      ├── Manage programs/projects
                      ├── Submit project proposal
                      ├── Admin reviews proposal
                      ├── Approve / reject / request revision
                      └── Run project events, tasks, attendance, and reports

Admin
  └── Create/manage program or project
      ├── Create events
      ├── Configure volunteer requirements
      ├── Review volunteer applications
      ├── Assign volunteers and tasks
      ├── Record/review attendance
      ├── Review reports and outcomes
      └── View analytics and exports

All roles
  └── Messages
      ├── Volunteer ↔ Admin
      ├── Volunteer ↔ Partner
      └── Partner ↔ Admin
```

## 6. System and synchronization layer

```text
Web browser                 ┐
Android APK                 ├── NVC API / VPS backend ── PostgreSQL database
Admin / Volunteer / Partner ┘              │
                                           ├── User profiles and roles
                                           ├── Programs/projects/events
                                           ├── Applications and assignments
                                           ├── Tasks and attendance
                                           ├── Reports and messages
                                           └── Uploaded images/documents

Google OAuth ── Sign in with Google
Google Calendar OAuth ── Calendar events shown in dashboard/event views
```

The web portal and Android APK should use the same backend and database. A profile change, application, assignment, attendance record, message, report, or map/project update should therefore be saved to the VPS backend and become available to the other client after it refreshes or reloads its data.

## 7. Supporting screens and reusable modules

These exist in the codebase but are not separate primary navigation items in the current role menus. Include them inside the related branch when drawing:

```text
Supporting modules
├── Project lifecycle/workspace
├── Project details
├── Proposal review
├── Partner approvals
├── Planning calendar
├── Volunteer program management
├── Volunteer reports
├── Partner reports
├── Admin reports
└── Shared map, messages, profile, and report components
```

## Suggested drawing layout

1. Put `NVC System` at the top.
2. Place `Authentication` below it.
3. Create three large columns: `Admin`, `Volunteer`, and `Partner`.
4. Put `Shared Features` in a fourth column or across the bottom.
5. Put `NVC API / VPS Backend`, `PostgreSQL`, and Google services below all three portals.
6. Use arrows for approval, proposal, assignment, attendance, reporting, messaging, and synchronization flows.
