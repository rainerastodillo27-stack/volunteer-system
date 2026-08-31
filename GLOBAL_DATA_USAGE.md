# Global Data Preloading - Usage Guide

## ✅ What's Implemented

All app data now loads once at startup (in 3 seconds) and gets cached in memory.
Screens can access this cached data instantly without individual loading states.

## 🚀 How to Use in Your Screens

### Before (Old Way - Slow):
```tsx
const [projects, setProjects] = useState<Project[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const load = async () => {
    setLoading(true);
    const data = await getAllProjects();
    setProjects(data);
    setLoading(false);
  };
  load();
}, []);

if (loading) return <ActivityIndicator />;
```

### After (New Way - Instant):
```tsx
import { useProjects } from '../contexts/GlobalDataContext';

// That's it! Data is already loaded
const { projects } = useProjects();

// No loading state needed - data is instant!
```

## 📚 Available Hooks

```tsx
import { 
  useGlobalData,    // Access everything
  useProjects,      // Just projects
  useVolunteers,    // Just volunteers  
  usePartners,      // Just partners
  useUsers          // Just users
} from '../contexts/GlobalDataContext';

// Full access to everything
const { 
  projects, volunteers, partners, users,
  reports, applications, matches, timeLogs,
  programTracks, isLoading, refreshData 
} = useGlobalData();

// Or just what you need
const { projects, refreshProjects } = useProjects();
const { volunteers } = useVolunteers();
const { partners } = usePartners();
```

## 🔄 Automatic Updates

Data automatically refreshes when anything changes in storage.
No manual refresh needed - it's real-time!

## 💡 Benefits

✅ 3-second startup load
✅ Instant screen loading (no per-screen spinners)
✅ Reduced database/API calls
✅ Automatic real-time updates
✅ Better user experience

## 📝 Example Screen Update

Here's how to update an existing screen:

```tsx
// OLD CODE - Remove this
const [projects, setProjects] = useState<Project[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  getAllProjects().then(setProjects).finally(() => setLoading(false));
}, []);

// NEW CODE - Replace with this
import { useProjects } from '../contexts/GlobalDataContext';
const { projects } = useProjects();
// That's it! No loading state needed
```

## 🎯 Next Steps

Update your screens to use cached data:
1. Import the appropriate hook
2. Remove individual data loading logic
3. Remove loading states
4. Enjoy instant screen loads!
