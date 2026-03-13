# Volunteer Management System

Expo and React Native app for managing volunteer programs, partner organizations, project coordination, and admin review workflows using local AsyncStorage only.

## Current Scope

- Admin web experience with sidebar navigation and project oversight
- Volunteer mobile experience for browsing projects, joining programs, and logging time
- Partner mobile experience for onboarding organizations/programs and requesting to join projects
- Local-only demo data and approvals, with no backend yet

## Tech Stack

- React Native 0.81
- Expo SDK 54
- React Navigation
- AsyncStorage
- TypeScript
- `date-fns`
- `react-native-maps`

## Installation

```bash
npm install
npm start
```

Platform shortcuts:

```bash
npm run android
npm run ios
npm run web
```

## Access Rules

- Admin accounts can log in on web only.
- Volunteer and partner accounts can log in on mobile only.
- Demo data is initialized on app startup from `models/storage.ts`.

## Demo Credentials

Web:

```text
admin@nvc.org
admin123
```

Mobile:

```text
volunteer@example.com
volunteer123
```

```text
partnerships@pbsp.org.ph
partner123
```

```text
partnerships@jollibeefoundation.org
partner123
```

```text
partner@livelihoods.org
partner123
```

## Seeded Demo Data

- Partners:
  - Philippine Business for Social Progress
  - Jollibee Group Foundation
  - LGU Kabankalan Livelihood Office
- Projects:
  - Bacolod Reading Hub Setup
  - Kabankalan Livelihood Training
  - NVM Coastal Cleanup
  - Masiglang Pagbubuntis, Masiglang Kamusmusan
- Users:
  - 1 admin
  - 1 volunteer
  - 3 partner accounts

## Current Features

### Authentication

- Local credential check against seeded users
- Platform-based login restrictions by role
- Demo credentials shown on the login screen

### Admin

- Dashboard with project, partner, volunteer, and update summaries
- Partner onboarding review with approve/reject actions
- Project lifecycle management and status updates
- Review of partner requests to join specific programs
- Volunteer management screen
- Messaging hub
- Impact reports
- Mapping screen

### Volunteer

- Volunteer dashboard
- Browse Negros-based projects and programs
- Join projects
- Time in and time out for joined projects
- Messaging hub
- Profile screen

### Partner Organizations

- Partner dashboard with organization and project summary
- Program or organization onboarding request for admin approval
- View sector needs
- Request to join any listed project
- Join requests remain pending until an admin approves them
- Messaging hub

## Approval Workflows

### Partner Onboarding

1. Partner submits a program or organization on the `Partners` screen.
2. Admin reviews it on the same screen.
3. Admin can approve or reject locally.

### Partner Joining a Project

1. Partner opens `Projects`.
2. Partner taps `Join as Partner`.
3. Request is stored locally as `Pending`.
4. Admin opens `Lifecycle`, selects a project, and reviews `Partner Join Requests`.
5. Approval marks the partner as joined for that project.

## Project Structure

```text
App.tsx
app.json
contexts/
models/
navigation/
screens/
types/
```

Key files:

- `models/storage.ts`: local persistence, seeded demo data, approval flows
- `models/types.ts`: shared types
- `screens/LoginScreen.tsx`: authentication UI and demo credentials
- `screens/ProjectsScreen.tsx`: volunteer and partner project actions
- `screens/PartnerOnboardingScreen.tsx`: partner onboarding and admin approval
- `screens/ProjectLifecycleScreen.tsx`: admin project status and partner join approvals
- `navigation/TabNavigator.tsx`: role-based tabs and admin web sidebar

## Development Notes

- Data persists in AsyncStorage.
- Clearing app storage resets the demo state.
- There is no backend, API, or server-side validation yet.
- Partner and volunteer accounts are intentionally blocked on web.

## Validation

TypeScript check:

```bash
npx tsc --noEmit
```
