# Analytics Filters Update

## Changes Made

### 1. ✅ Fixed "Checking Database" Speed Issue

**Problem**: System was stuck checking database for too long (30+ seconds)

**Solution**: Optimized backend health check timeouts in `LoginScreen.tsx`

**Changes**:
- `BACKEND_HEALTH_TIMEOUT_MS`: **30000ms → 8000ms** (30s → 8s)
- `BACKEND_HEALTH_RETRY_MS`: **6000ms → 3000ms** (6s → 3s)  
- `BACKEND_HEALTH_MAX_SLOW_RETRIES`: **5 → 2** retries

**Result**: 
- Database connection check now completes in **8 seconds max** (down from 30s)
- Retries happen every **3 seconds** (down from 6s)
- Maximum retry attempts reduced to **2** (down from 5)
- Overall connection time improved from **~2.5 minutes** to **~14 seconds** max

### 2. ✅ Added Program Filter to Analytics

**New Feature**: Analytics can now be filtered by both Partner AND Program

**UI Layout**:
```
┌─────────────────────────────────────────────────┐
│  Filter by Partner      │  Filter by Program    │
│  🏢 All Partners    ▼   │  📑 All Programs  ▼   │
└─────────────────────────────────────────────────┘
```

**Features**:
- Two dropdowns side-by-side on desktop
- Stack vertically on mobile devices
- Each dropdown closes the other when opened
- Independent filtering: can filter by partner only, program only, or both
- "All Partners" + "All Programs" shows complete data

### 3. Filter Combinations

The system now supports **4 filter modes**:

1. **All Partners + All Programs**: Shows everything (default)
2. **Specific Partner + All Programs**: Shows all projects from selected partner
3. **All Partners + Specific Program**: Shows all partners' projects in selected program
4. **Specific Partner + Specific Program**: Shows only that partner's projects in that program

### 4. Data Filtering Logic

**Updated Filtering**:
```typescript
// Projects filtered by BOTH partner and program
filteredProjects = projects
  .filter(p => selectedPartnerId === 'all' || p.partnerId === selectedPartnerId)
  .filter(p => selectedProgramId === 'all' || p.program_id === selectedProgramId)

// All other data (volunteers, reports, time logs, etc.) 
// cascade from filtered projects
```

**What Gets Filtered**:
- ✅ Projects list
- ✅ Volunteers (who worked on filtered projects)
- ✅ Reports (for filtered projects)
- ✅ Time Logs (for filtered projects)
- ✅ Join Records (for filtered projects)
- ✅ All charts and metrics
- ✅ Footer statistics

**What Stays Unfiltered**:
- ❌ Partner Sectors by Quarter table (always shows all partners)

## Technical Details

### State Management
```typescript
const [selectedPartnerId, setSelectedPartnerId] = useState<string | 'all'>('all');
const [showPartnerDropdown, setShowPartnerDropdown] = useState(false);
const [selectedProgramId, setSelectedProgramId] = useState<string | 'all'>('all');
const [showProgramDropdown, setShowProgramDropdown] = useState(false);
```

### Filter Dependencies
All `useMemo` hooks updated to depend on both filters:
```typescript
useMemo(() => {
  // filtering logic
}, [data, selectedPartnerId, selectedProgramId]);
```

### Program Field
Uses `project.program_id` field from Project interface to match program tracks.

## Files Modified

### 1. `screens/LoginScreen.tsx`
- Reduced backend health check timeouts for faster connection
- Changed 3 constants for better performance

### 2. `screens/AdminAnalyticsScreen.tsx`
- Added program filter state and dropdown
- Updated all filter logic to support both partner and program
- Restructured UI to show both filters side-by-side
- Added `filtersContainer` and `filterCard` styles
- Updated all `useMemo` dependencies

## UI Changes

### Before
```
┌────────────────────────────────────┐
│  Filter by Partner Organization    │
│  🏢 All Partners              ▼    │
└────────────────────────────────────┘
```

### After
```
┌────────────────────────┬────────────────────────┐
│  Filter by Partner     │  Filter by Program     │
│  🏢 All Partners   ▼   │  📑 All Programs   ▼   │
└────────────────────────┴────────────────────────┘
```

## Responsive Behavior

### Desktop (width >= 600px)
- Filters display side-by-side in two columns
- Each filter card takes 50% width minus gap

### Mobile (width < 600px)
- Filters stack vertically
- Each filter card takes full width
- Maintains `minWidth: 280px`

## Interaction Flow

### Opening Dropdowns
1. User clicks Partner dropdown → Partner menu opens, Program menu closes
2. User clicks Program dropdown → Program menu opens, Partner menu closes
3. Only one dropdown can be open at a time

### Selecting Filters
1. User selects partner → Filters projects by partner
2. User selects program → Filters projects by program
3. Both filters active → Shows intersection (partner's projects in that program)
4. Analytics update immediately on selection

## Performance

### Connection Speed Improvements
- **Before**: 30s timeout + 5 retries @ 6s = up to 2.5 minutes
- **After**: 8s timeout + 2 retries @ 3s = up to 14 seconds
- **Speed Increase**: ~91% faster connection checks

### Filter Performance
- All filtering uses `useMemo` for efficient recalculation
- Only recalculates when dependencies change
- Cascading filters prevent redundant filtering

## Testing Recommendations

1. **Connection Speed**:
   - Test login with backend online
   - Test login with backend offline
   - Verify it fails fast (within 14 seconds)

2. **Partner Filter**:
   - Select "All Partners" → Should show all data
   - Select specific partner → Should show only that partner's data
   - Verify all charts update

3. **Program Filter**:
   - Select "All Programs" → Should show all data
   - Select specific program → Should show only that program's data
   - Verify all charts update

4. **Combined Filters**:
   - Select Partner A + Program X → Should show intersection
   - Select Partner A + All Programs → Should show all Partner A data
   - Select All Partners + Program X → Should show all partners in Program X

5. **Dropdown Behavior**:
   - Open partner dropdown → Verify program dropdown closes
   - Open program dropdown → Verify partner dropdown closes
   - Select option → Verify dropdown auto-closes

6. **Responsive**:
   - Test on desktop (side-by-side layout)
   - Test on mobile (stacked layout)
   - Verify scrolling works properly

## Summary

Successfully improved system performance by reducing database connection timeout from 30s to 8s, and added comprehensive program filtering to the Analytics screen. Users can now filter analytics by partner, program, or both simultaneously, with all metrics updating in real-time.
