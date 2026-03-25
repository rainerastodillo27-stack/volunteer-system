# Quick Start Guide - Volcre

## Initial Setup (5 minutes)

### 1. Install Dependencies
```bash
cd volcre
npm install
```

### 2. Start the Development Server
```bash
npm start
```

### 3. Choose Your Platform
- **Android:** Press `a` or run `npm run android`
- **iOS:** Press `i` or run `npm run ios`
- **Web:** Press `w` or run `npm run web`

---

## First Login

### Admin Account (Full Access):
```
Email: admin@nvc.org
Password: admin123
```

### Partner Accounts (Org Access):
```
PBSP: partnerships@pbsp.org.ph / partner123
Jollibee Foundation: partnerships@jollibeefoundation.org / partner123
Kabankalan LGU: partner@livelihoods.org / partner123
```

### Volunteer Account (Limited Access):
```
Email: volunteer@example.com
Password: volunteer123
```

---

## Testing Each Feature

### 1. **Partner Onboarding** (Admin Only)
1. Login as admin
2. Navigate to "Partners" tab
3. View 2 mock partners (1 Approved, 1 Pending)
4. Click filter buttons to see status breakdown
5. Click "+" button to add new partner (placeholder)

**What to test:**
- Filter between Approved/Pending partners
- View partner details
- Approve/Reject actions (if pending)

---

### 2. **Project Lifecycle Tracking**
1. Go to "Lifecycle" tab
2. See 2 projects with status timelines
3. Click a project to view/edit
4. Add status updates in detail view
5. See them appear in the timeline

**What to test:**
- View project details
- Add status updates
- See real-time updates
- Status color coding

---

### 3. **Geospatial Mapping**
1. Go to "Map" tab
2. See interactive map with numbered pins
3. See project list below with GPS coordinates
4. Click any project card to see full details
5. View distance calculations

**What to test:**
- Interactive map pins
- Project location details
- GPS coordinates
- Distance calculations

---

### 4. **Communication Hub**
1. Go to "Messages" tab
2. See available conversations
3. Click a conversation to open
4. Send a message
5. See it appear immediately

**What to test:**
- Message sending
- Real-time updates
- Conversation management
- Unread badges

---

### 5. **Volunteer Management** (Admin Only)
1. Login as admin
2. Go to "Volunteers" tab
3. Toggle between "List" and "AI Matching" views
4. Click a volunteer to see profile
5. View availability and update if needed
6. See suggested project matches

**What to test:**
- View volunteer profiles
- Update availability
- See match scores
- AI recommendations

---

### 7. **Dashboard**
1. Go to "Dashboard" tab
2. See key metrics (Projects, Partners, Volunteers, Active)
3. View project breakdown (In Progress vs Completed)
4. See recent updates timeline
5. Use quick action buttons

**What to test:**
- All metric cards display
- Project overview stats
- Timeline updates
- Quick navigation

---

## Mock Data Overview

### Pre-loaded Users:
- 1 Admin user
- 3 Partner users (PBSP, Jollibee Foundation, Kabankalan LGU)
- 1 Volunteer user

### Pre-loaded Partners:
- Philippine Business for Social Progress (Approved)
- Jollibee Group Foundation (Approved)
- LGU Kabankalan Livelihood Office (Pending)

### Pre-loaded Projects:
- "Rural School Library Setup" (In Progress)
- "Vocational Training Program" (Planning)

### Pre-loaded Volunteer Profile:
- John Volunteer with skills: Teaching, Mentoring, Community Outreach

---

## Customizing the App

### Add More Mock Data:
Edit `models/storage.ts` → `initializeMockData()` function

### Change Default Demo Credentials:
Edit `models/storage.ts` → Create additional users in `initializeMockData()`

### Modify Theme Colors:
Search for `#4CAF50` (green), `#2196F3` (blue), etc. in component files

### Add New Partner Categories:
Edit `models/types.ts` → Update `Partner.category` type

---

## Common Tasks

### Test Admin Features:
1. Login as admin
2. Check "Partners" tab
3. Check "Volunteers" tab
4. View pending partner applications
5. View volunteer-project recommendations

### Test Volunteer Features:
1. Login as volunteer
2. View projects on "Projects" tab
3. Check messages in "Messages"
4. View availability on "Volunteers" tab
5. See project lifecycle updates

### Reset App (Clear All Data):
1. Uninstall the app from your device/simulator
2. Clear app cache if testing on web
3. Restart development server
4. App will reinitialize with fresh mock data

---

## Troubleshooting

### App won't start?
```bash
npm install
npm start
```

### Missing dependencies?
```bash
npm install react-native-maps expo-location date-fns @react-native-async-storage/async-storage
```

### Can't login?
- Use exact credentials:
  - Admin: `admin@nvc.org` / `admin123`
  - Volunteer: `volunteer@example.com` / `volunteer123`

### No data showing?
- First load initializes mock data (takes a moment)
- Check browser console for errors
- Try logging out and back in

### TypeScript errors?
- Errors are safe to ignore for development
- Run `npm install` to ensure types are installed

---

## Performance Tips

- App reads shared data from the backend API
- Suitable for 100+ data records without issues
- Backend and Postgres must be available

---

## Next Steps

1. **Review** the code structure in `models/types.ts` and `models/storage.ts`
2. **Explore** individual screen components
3. **Test** authentication context in `contexts/AuthContext.tsx`
4. **Modify** demo data to match your needs
5. **Connect** to a backend API when ready

---

## File Reference

Important files to understand the architecture:

| File | Purpose |
|------|---------|
| `models/types.ts` | All TypeScript interfaces |
| `models/storage.ts` | Data persistence & mock data |
| `contexts/AuthContext.tsx` | Authentication state management |
| `navigation/TabNavigator.tsx` | Main navigation structure |
| `screens/DashboardScreen.tsx` | Main dashboard |
| `package.json` | Dependencies & scripts |

---

## Development Server Commands

```bash
npm start          # Start dev server
npm run android    # Build for Android
npm run ios        # Build for iOS
npm run web        # Run on web browser
npm test           # Run tests (if configured)
```

---

**Happy Testing! 🎉**

For detailed feature documentation, see `FEATURES_IMPLEMENTED.md`
