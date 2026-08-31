# Analytics Screen UI Structure (Updated)

## Screen Layout (Top to Bottom)

```
┌─────────────────────────────────────────────────────────────┐
│  📊 ANALYTICS SCREEN                                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 🆕 PARTNER SELECTOR                                   │ │
│  │ Filter by Partner Organization                        │ │
│  │ ┌─────────────────────────────────────────────────┐   │ │
│  │ │ 🏢 All Partners                            ▼    │   │ │
│  │ └─────────────────────────────────────────────────┘   │ │
│  │                                                       │ │
│  │ [When expanded, shows dropdown menu:]                │ │
│  │ ┌─────────────────────────────────────────────────┐   │ │
│  │ │ 📊 All Partners                            ✓    │   │ │
│  │ │ 🏢 Partner Organization 1                      │   │ │
│  │ │ 🏢 Partner Organization 2                      │   │ │
│  │ │ 🏢 Partner Organization 3                      │   │ │
│  │ └─────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ TOTAL VOLUNTEERS (FILTERED)                           │ │
│  │ Cumulative growth across the last 12 months           │ │
│  │                                                       │ │
│  │  [Line Chart showing volunteer growth]                │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌─────────────────────────┐  ┌──────────────────────────┐ │
│  │ VOLUNTEERS PER EVENT    │  │ SKILLS CONTRIBUTED       │ │
│  │ (FILTERED)              │  │ (FILTERED)               │ │
│  │                         │  │                          │ │
│  │  [Event Heatmap]        │  │  [Donut Chart]           │ │
│  │                         │  │                          │ │
│  └─────────────────────────┘  └──────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ PROJECT STATUS OVERVIEW (FILTERED)                    │ │
│  │ • Planning: 5                                         │ │
│  │ • In Progress: 12                                     │ │
│  │ • On Hold: 2                                          │ │
│  │ • Completed: 8                                        │ │
│  │ • Cancelled: 1                                        │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ PROJECTS TRACKING (FILTERED)                          │ │
│  │                                                       │ │
│  │  [List of partner projects with stats]                │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ 🆕 PARTNER SECTORS BY QUARTER                         │ │
│  │ New partner organizations grouped by creation quarter │ │
│  │                                                       │ │
│  │ ┌─────────────────────────────────────────────────┐   │ │
│  │ │ Quarter  │  NGO  │ Hospital │ Institution │ Private│ │
│  │ ├─────────────────────────────────────────────────┤   │ │
│  │ │ Q4 2025  │   0   │    0     │      0      │   0   │ │
│  │ │ Q1 2026  │   0   │    0     │      0      │   0   │ │
│  │ │ Q2 2026  │   0   │    0     │      0      │   0   │ │
│  │ │ Q3 2026  │   1   │    1     │      0      │   0   │ │
│  │ └─────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  [Footer Stats - FILTERED]                                 │
│  Event reports: 45 • Completed hours: 1,234 • Events: 28  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## New Components Detail

### 1. Partner Selector Dropdown

**Collapsed State:**
```
┌────────────────────────────────────────┐
│ Filter by Partner Organization         │
│ ┌────────────────────────────────────┐ │
│ │ 🏢 All Partners              ▼    │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

**Expanded State:**
```
┌────────────────────────────────────────┐
│ Filter by Partner Organization         │
│ ┌────────────────────────────────────┐ │
│ │ 🏢 All Partners              ▲    │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ 📊 All Partners              ✓    │ │ ← Selected (green bg)
│ │ 🏢 NGO Partner A                  │ │
│ │ 🏢 Hospital Partner B             │ │
│ │ 🏢 Institution Partner C          │ │
│ │ 🏢 Private Partner D              │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### 2. Partner Sectors by Quarter Table

**Table Structure:**
```
┌─────────────────────────────────────────────────────────────┐
│ PARTNER SECTORS BY QUARTER                                  │
│ New partner organizations grouped by creation quarter       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┏━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━━┳━━━━━━━━━━━━━┳━━━━━━━━┓  │
│  ┃ Quarter ┃   NGO   ┃ Hospital ┃ Institution ┃ Private┃  │ ← Green header
│  ┣━━━━━━━━━╋━━━━━━━━━╋━━━━━━━━━━╋━━━━━━━━━━━━━╋━━━━━━━━┫  │
│  ┃ Q4 2025 ┃    0    ┃    0     ┃      0      ┃   0   ┃  │ ← White bg
│  ┃ Q1 2026 ┃    0    ┃    0     ┃      0      ┃   0   ┃  │ ← Gray bg
│  ┃ Q2 2026 ┃    0    ┃    0     ┃      0      ┃   0   ┃  │ ← White bg
│  ┃ Q3 2026 ┃    1    ┃    1     ┃      0      ┃   0   ┃  │ ← Gray bg
│  ┗━━━━━━━━━┻━━━━━━━━━┻━━━━━━━━━━┻━━━━━━━━━━━━━┻━━━━━━━━┛  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Color Scheme

### Partner Selector
- **Card Background**: White (#FFFFFF)
- **Border**: Green-200 (#D1DDC6)
- **Selected Item**: Green-50 background with Green-700 text
- **Icons**: Green-700 (#4B7D3C)
- **Text**: Primary gray for labels, dark for selected

### Sectors Table
- **Header**: Primary Green-700 (#4B7D3C) with white text
- **Row Backgrounds**: Alternating white / tertiary background
- **Text**: Bold for quarters, semibold for values
- **Borders**: Neutral-200 (#E5E7EB)

## Responsive Behavior

### Desktop (width >= 980px)
- Partner selector: Full width with dropdown
- Heatmap and skills charts: Side by side
- Sectors table: Full width, no scroll needed

### Mobile (width < 980px)
- Partner selector: Full width, stacked
- Heatmap and skills: Stacked vertically
- Sectors table: Horizontal scroll enabled

## Interaction Flow

```
1. User opens Analytics screen
   ↓
2. Sees "All Partners" selected by default
   ↓
3. Clicks dropdown button
   ↓
4. Dropdown menu expands
   ↓
5. User selects specific partner
   ↓
6. Dropdown closes automatically
   ↓
7. All charts/metrics update instantly
   ↓
8. User sees filtered data for selected partner
```

## Data Filtering Logic

```
Selected Partner: "All Partners"
├─ Projects: ALL
├─ Volunteers: ALL
├─ Reports: ALL
├─ Time Logs: ALL
└─ Events: ALL

Selected Partner: "Specific Partner X"
├─ Projects: WHERE partnerId = X
├─ Volunteers: WHERE participated in Partner X projects
├─ Reports: WHERE project IN Partner X projects
├─ Time Logs: WHERE project IN Partner X projects
└─ Events: WHERE event IN Partner X projects

Partner Sectors Table: ALWAYS shows ALL partners (not filtered)
```

## Key Features

✅ **Instant Filtering** - All metrics update immediately on partner selection
✅ **Clean UI** - Matches existing design system perfectly
✅ **Mobile Friendly** - Responsive layout with horizontal scroll
✅ **Visual Feedback** - Check marks and color changes on selection
✅ **Quarterly Insights** - New sector breakdown table for partner trends
✅ **Accessible** - Clear labels and logical tab order
✅ **Performance** - Uses useMemo for efficient recalculation
