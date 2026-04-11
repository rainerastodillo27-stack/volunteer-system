# Volcre

Expo and React Native app for managing volunteer programs, partner organizations, project coordination, and admin review workflows. The app reads and writes through a Python API backed by Supabase Postgres.

## Public HTTPS Backend

Recommended production-style setup:

```text
phone / browser -> HTTPS backend -> Supabase Postgres
```

This avoids depending on your laptop's raw Postgres connectivity on every Wi-Fi network.

The repo now includes [../render.yaml](/c:/Users/ACER/OneDrive/Desktop/volunteer system2/render.yaml) for deploying the FastAPI backend on Render in Singapore, plus [../DEPLOYMENT.md](/c:/Users/ACER/OneDrive/Desktop/volunteer system2/DEPLOYMENT.md) with the exact steps.

After deployment, set:

```text
VOLCRE_API_BASE_URL=https://your-service.onrender.com
VOLCRE_WEB_API_BASE_URL=https://your-service.onrender.com
VOLCRE_AUTO_START_BACKEND=false
```

Then restart Expo so the app uses the hosted backend instead of a local one.

## Current Scope

- Admin web experience with sidebar navigation and project oversight
- Volunteer mobile experience for browsing projects, joining programs, and logging time
- Partner mobile experience for onboarding organizations/programs and requesting to join projects
- Local-only demo data and approvals in the app runtime
- Optional Python scripts for Supabase Postgres schema setup and demo seeding

## Tech Stack

- React Native 0.81
- Expo SDK 54
- React Navigation
- TypeScript
- `date-fns`
- `react-native-maps`
- Python 3 with `psycopg`

## Supabase Postgres

Yes. Supabase uses PostgreSQL.

The database URL you pasted is a PostgreSQL connection string, so it can be used directly by Python with `psycopg`.

Python setup files:

- [backend/requirements.txt](/c:/Users/ACER/OneDrive/Desktop/volunteer-system/backend/requirements.txt)
- [.env.example](/c:/Users/ACER/OneDrive/Desktop/volunteer%20system2/volunteer-system/.env.example)
- [backend/init_supabase.py](/c:/Users/ACER/OneDrive/Desktop/volunteer-system/backend/init_supabase.py)
- [backend/seed_demo_data.py](/c:/Users/ACER/OneDrive/Desktop/volunteer-system/backend/seed_demo_data.py)
- [backend/api.py](/c:/Users/ACER/OneDrive/Desktop/volunteer-system/backend/api.py)
- [app.json](/c:/Users/ACER/OneDrive/Desktop/volunteer-system/app.json)

Run it like this:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create `.env` in the app root from the repo example:

```bash
cd ..
copy .env.example .env
```

Put your real password in `.env`:

```text
SUPABASE_DB_URL=postgresql://postgres:YOUR_REAL_PASSWORD@db.zargqwmmibyxwwidzucv.supabase.co:5432/postgres
```

Then create the schema and seed demo records:

```bash
python init_supabase.py
python seed_demo_data.py
```

To connect the app runtime to the database-backed Python API:

```bash
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

The app reads and writes through the Python API only. Supabase Postgres is required for shared data.

Default API base URL:

```text
http://127.0.0.1:8000
```

You can change it in Expo config here:

- [app.json](/c:/Users/ACER/OneDrive/Desktop/volunteer-system/app.json)

If you use a physical phone instead of web or an emulator, replace `127.0.0.1` with your computer's LAN IP or deploy the Python API and use its public URL.

Important:

- Do not commit your real Supabase password.
- The Expo app must not connect directly to raw Postgres with the database password.
- The safe path is the included Python API, which now backs the app storage layer.

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

Supervised dev mode (keeps the backend and Expo running and restarts them if they crash):

```bash
npm run all:bg
npm run all:status
npm run all:stop
```

Backend:

```bash
npm run backend
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

- API-backed credential check against seeded users
- Platform-based login restrictions by role
- Demo credentials shown on the login screen
- Session is in memory only, so refresh/restart requires logging in again

### Admin

- Dashboard with project, partner, volunteer, and update summaries
- Partner onboarding review with approve/reject actions
- Project lifecycle management and status updates
- Review of partner requests to join specific programs
- Volunteer management screen
- Messaging hub
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
3. Request is stored in the backend as `Pending`.
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

- `models/storage.ts`: client gateway for backend reads/writes, in-memory session, approval flows
- `models/types.ts`: shared types
- `screens/LoginScreen.tsx`: authentication UI and demo credentials
- `screens/ProjectsScreen.tsx`: volunteer and partner project actions
- `screens/PartnerOnboardingScreen.tsx`: partner onboarding and admin approval
- `screens/ProjectLifecycleScreen.tsx`: admin project status and partner join approvals
- `navigation/TabNavigator.tsx`: role-based tabs and admin web sidebar

## Development Notes

- Shared data persists in Postgres.
- `currentUser` is stored in memory only.
- Refreshing the app or restarting the client signs the current user out.
- The backend API must be running and connected to Postgres.
- Partner and volunteer accounts are intentionally blocked on web.

## Validation

TypeScript check:

```bash
npx tsc --noEmit
```
