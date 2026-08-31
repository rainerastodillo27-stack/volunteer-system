# Analytics Partner Filter & Sector Report

## Overview
Added partner-based filtering to the Analytics screen with a dropdown selector and a new "Partner Sectors by Quarter" table showing quarterly partner organization breakdown by type.

## Changes Made

### 1. Partner Selector Dropdown
- **Location**: Top of AdminAnalyticsScreen, above all charts
- **Features**:
  - Dropdown menu to select a specific partner or "All Partners"
  - Shows selected partner name with business icon
  - Expandable/collapsible menu with checkmark on selected item
  - Clean, modern UI matching existing design system

### 2. Data Filtering
All analytics data now filters based on selected partner:
- **Projects**: Only shows projects belonging to selected partner
- **Volunteers**: Only includes volunteers who participated in partner's projects
- **Time Logs**: Filtered to partner's project activities
- **Reports**: Limited to reports for partner's projects
- **Join Records**: Only volunteer joins for partner projects

### 3. Analytics Updates
The following sections now update based on partner selection:
- ✅ Total Volunteers chart (cumulative growth)
- ✅ Volunteers per Event heatmap
- ✅ Skills Contributed donut chart
- ✅ Project Status Overview counts
- ✅ Projects Tracking list
- ✅ Footer stats (Event reports, Completed hours, Tracked events)

### 4. Partner Sectors by Quarter Table
**New Section**: Shows quarterly breakdown of new partner organizations

**Columns**:
- Quarter (Q1 2026, Q2 2026, etc.)
- NGO
- Hospital  
- Institution
- Private

**Features**:
- Shows last 4 quarters including current
- Counts partners created in each quarter by sector type
- Horizontally scrollable on smaller screens
- Alternating row colors for readability
- Header row with green background matching theme

## Technical Implementation

### State Management
```typescript
const [selectedPartnerId, setSelectedPartnerId] = useState<string | 'all'>('all');
const [showPartnerDropdown, setShowPartnerDropdown] = useState(false);
```

### Filtered Data (useMemo hooks)
- `filteredProjects`: Projects for selected partner
- `filteredReports`: Reports for filtered projects
- `filteredTimeLogs`: Time logs for filtered projects
- `filteredJoinRecords`: Join records for filtered projects
- `filteredVolunteers`: Volunteers who participated in filtered projects

### Helper Function
```typescript
buildPartnerSectorsByQuarter(partners: Partner[]): PartnerSectorData[]
```
- Generates last 4 quarters including current
- Counts new partners by `sectorType` field per quarter
- Returns array of quarter data with counts for each sector

## UI Components Added

### Partner Selector Card
- Positioned at top with z-index for dropdown overlay
- Includes label, button, and expandable menu
- Touch/click handlers for dropdown toggle
- Active state styling for selected item

### Sectors by Quarter Card
- Table layout with header row
- Scrollable container for mobile responsiveness
- Alternating row backgrounds
- Centered values with bold quarter labels

## Styling
All new styles follow ModernTheme design system:
- Colors: Primary green palette with neutral backgrounds
- Spacing: Consistent with existing spacing scale
- Typography: Font sizes and weights match current components
- Shadows: Base and small shadows for depth
- Border Radius: Rounded corners matching theme

## Partner Type Field
Uses `partner.sectorType` which maps to `PartnerSectorType`:
- `'NGO'`
- `'Hospital'`
- `'Institution'`
- `'Private'`

## Data Flow
1. User selects partner from dropdown
2. `selectedPartnerId` state updates
3. All `filtered*` memos recalculate
4. Charts and tables re-render with filtered data
5. Footer stats update to show filtered totals

## Notes
- "All Partners" (selectedPartnerId === 'all') shows complete unfiltered data
- Partner sectors table always shows all partners (not filtered)
- Dropdown closes automatically after selection
- Real-time updates via existing storage subscriptions
