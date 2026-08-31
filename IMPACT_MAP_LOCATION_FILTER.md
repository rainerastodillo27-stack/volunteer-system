# Impact Map Location Filter Feature

## Overview

Added a location-based filter to the Impact Map that allows users to filter projects by city/region. The filter shows only locations that have available projects and displays the project count for each location.

## Changes Made

### 1. Added Location State Management

**File:** `components/VolunteerImpactMap.web.tsx`

Added three new state variables:
```typescript
const [showLocationMenu, setShowLocationMenu] = useState(false);
const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
```

### 2. Built Available Locations List

Created a `useMemo` hook that:
- Extracts unique city/region combinations from all projects
- Counts how many projects exist in each location
- Sorts locations by project count (descending) to show most active locations first
- Only includes locations that have at least one project

**Location Key Format:** `{region}|{city}` (e.g., `"Negros Island Region (NIR)|Enrique B. Magalona"`)

**Location Label Format:** `{city}, {region}` (e.g., `"Enrique B. Magalona, Negros Island Region (NIR)"`)

```typescript
const availableLocations = useMemo(() => {
  const locationMap = new Map<string, { count: number; label: string }>();
  
  scopedProjects.forEach(project => {
    const region = project.locationRegion || project.location.region;
    const city = project.locationCity || project.location.city;
    
    if (region && city) {
      const locationKey = `${region}|${city}`;
      const locationLabel = `${city}, ${region}`;
      // ... count projects per location
    }
  });
  
  return sortedByProjectCount;
}, [scopedProjects]);
```

### 3. Updated Project Filtering Logic

Modified `displayProjects` to filter by both status AND location:

```typescript
const displayProjects = useMemo(() => {
  let filtered = scopedProjects;
  
  // Filter by status (existing)
  if (selectedStatus) {
    filtered = filtered.filter(/* status match */);
  }
  
  // Filter by location (NEW)
  if (selectedLocation) {
    filtered = filtered.filter(project => {
      const region = project.locationRegion || project.location.region;
      const city = project.locationCity || project.location.city;
      const locationKey = `${region}|${city}`;
      return locationKey === selectedLocation;
    });
  }
  
  return filtered;
}, [scopedProjects, selectedStatus, selectedLocation]);
```

### 4. Added Location Filter Button

Added a new button in the header actions (appears before the account picker):

**Features:**
- Shows "All Locations" by default
- When a location is selected:
  - Background changes to accent color (active state)
  - Shows the selected location name
  - Displays an "X" button to quickly clear the filter
- Only appears when there are available locations to filter

**Visual States:**
- **Inactive:** Light background, border, dark text, dropdown arrow
- **Active:** Solid accent color background, white text, "X" close button

```typescript
<TouchableOpacity
  style={[
    styles.mapStyleButton,
    styles.locationPickerButton,
    {
      backgroundColor: selectedLocation ? accentColor : chipBg,
      borderColor: selectedLocation ? accentColor : chipBorder,
    },
  ]}
  onPress={() => setShowLocationMenu(true)}
>
  <MaterialIcons name="location-city" size={18} color={...} />
  <Text>{selectedLocation ? locationName : 'All Locations'}</Text>
  {selectedLocation ? <CloseButton /> : <DropdownArrow />}
</TouchableOpacity>
```

### 5. Created Location Selection Modal

Added a modal that displays:

**Header:**
- Title: "Filter by Location"
- Subtitle: "Select a location with available projects"

**Options:**
1. **"All Locations"** option (clears filter)
   - Shows total project count
   - Has checkmark when selected (no filter active)

2. **Individual location options** (sorted by project count)
   - Each shows: "{City}, {Region}"
   - Displays project count: "X projects" or "1 project"
   - Has checkmark when selected
   - Active option has light blue background

```typescript
<Modal visible={showLocationMenu}>
  <View style={styles.mapStyleMenu}>
    <Text>Filter by Location</Text>
    <Text>Select a location with available projects</Text>
    
    <ScrollView>
      {/* All Locations option */}
      <TouchableOpacity onPress={() => setSelectedLocation(null)}>
        <Text>All Locations</Text>
        <Text>{totalProjects} projects</Text>
      </TouchableOpacity>
      
      {/* Individual locations */}
      {availableLocations.map(location => (
        <TouchableOpacity onPress={() => setSelectedLocation(location.key)}>
          <Text>{location.label}</Text>
          <Text>{location.count} projects</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  </View>
</Modal>
```

### 6. Updated Legend "Clear Filter" Button

Modified the legend's footer button to:
- Clear BOTH status and location filters when clicked
- Show "Clear filters" (plural) when either filter is active
- Updated the `getMapLegendFootnote` function to accept `selectedLocation` parameter

```typescript
<TouchableOpacity onPress={() => {
  setSelectedStatus(null);
  setSelectedLocation(null);
}}>
  <Text>{getMapLegendFootnote(styleKey, selectedStatus, selectedLocation)}</Text>
</TouchableOpacity>
```

### 7. Added Styles

New styles added:
```typescript
locationPickerButton: {
  maxWidth: 200,
},
locationPickerText: {
  flexShrink: 1,
},
locationMenuSubtitle: {
  fontSize: 12,
  color: '#64748b',
  marginBottom: 10,
  lineHeight: 17,
},
```

## User Experience Flow

### Viewing Available Locations

1. User opens Impact Map
2. Location filter button appears in header (next to view mode selector)
3. Button shows "All Locations" with location-city icon
4. Click button → Modal opens showing all available locations

### Filtering by Location

1. User clicks location filter button
2. Modal displays:
   - "Filter by Location" title
   - Helpful subtitle: "Select a location with available projects"
   - "All Locations" option at top (with total count)
   - List of locations sorted by project count (most active first)
3. Each location shows: "{City}, {Region}" and "X projects"
4. User selects a location
5. Modal closes
6. Map updates to show only projects in that location
7. Filter button shows selected location name with active styling
8. Legend updates to show filtered project count

### Clearing Location Filter

**Method 1: Quick Clear (from filter button)**
- Click the "X" button on the active filter button
- Immediately clears filter without opening modal

**Method 2: Select "All Locations"**
- Open location filter modal
- Click "All Locations" option
- Modal closes, filter cleared

**Method 3: Clear All Filters (from legend)**
- Click "Clear filters" in legend footer
- Clears both status AND location filters

### Combined Filtering

Users can combine status and location filters:

**Example:**
1. Filter by Status: "In Progress"
2. Filter by Location: "Bacolod City, Negros Occidental"
3. **Result:** Shows only in-progress projects in Bacolod City
4. Map displays filtered markers
5. Legend shows: "X projects" (filtered count)
6. Legend footer: "Clear filters"

## Data Sources

The filter uses two possible location data sources (for backward compatibility):

1. **New structure:** `project.locationRegion` and `project.locationCity`
2. **Legacy structure:** `project.location.region` and `project.location.city`

The code checks the new structure first, falls back to legacy if not found.

## Benefits

✅ **Only shows locations with data** - No empty location options  
✅ **Shows project count per location** - Helps users understand data distribution  
✅ **Sorted by activity** - Most active locations appear first  
✅ **Clear visual feedback** - Active filter has distinct styling  
✅ **Multiple clear methods** - Quick "X" button or modal selection  
✅ **Works with other filters** - Combines with status filtering  
✅ **Responsive design** - Adapts to available space  
✅ **Accessible** - Clear labels and counts for each option  

## Technical Notes

### Performance Optimization

- `availableLocations` uses `useMemo` to prevent recalculation on every render
- Only recalculates when `scopedProjects` changes
- `displayProjects` uses `useMemo` to efficiently filter projects
- Only recalculates when `scopedProjects`, `selectedStatus`, or `selectedLocation` changes

### Location Matching

The filter uses exact key matching:
- Submission key: `"${region}|${city}"`
- Comparison key: `"${project.region}|${project.city}"`
- This ensures accurate filtering even if city names are similar across regions

### Empty State Handling

If no projects match the selected filters:
- Map shows "No map data to show" overlay
- Message adapts based on current view mode
- Users can click "Clear filters" to reset

## Future Enhancements

Possible improvements:
1. **Barangay-level filtering** - For events with `locationBarangay` data
2. **Search within locations** - For datasets with many locations
3. **Region-only filtering** - Group by region instead of city
4. **Location statistics** - Show status breakdown per location
5. **Favorite locations** - Let users save frequently filtered locations
6. **URL parameters** - Persist filter in URL for sharing filtered views

## Testing Checklist

- [ ] Location filter button appears when projects have location data
- [ ] Location filter button hidden when no projects have location data
- [ ] Modal shows "All Locations" option with correct total count
- [ ] Modal lists all unique city/region combinations
- [ ] Locations sorted by project count (highest first)
- [ ] Each location shows correct project count
- [ ] Selecting a location filters the map correctly
- [ ] Selected location shows in filter button with active styling
- [ ] Quick "X" button clears filter without opening modal
- [ ] "All Locations" option clears filter and closes modal
- [ ] Legend "Clear filters" clears both status and location
- [ ] Combining status + location filters works correctly
- [ ] Map updates smoothly when filters change
- [ ] Empty state shows when no projects match filters
- [ ] Works correctly in admin overview mode
- [ ] Works correctly in volunteer view mode
- [ ] Works correctly in partner view mode
