# Data Fetch Delay Analysis

## Current Polling/Subscription Setup

### 1. Communication Hub Screen
**Location:** `screens/CommunicationHubScreen.tsx`

**Issues Found:**
- **Line ~1258**: Direct messages poll every **1 second** (`DIRECT_BACKEND_MESSAGE_POLL_MS = 1000`)
- **Line ~1357**: Proposal data polls every **5 seconds** (`setInterval(loadData, 5000)`)
- These run **continuously** even when not needed

### 2. In-App Notification Banner
**Location:** `components/InAppNotificationBanner.tsx`

**Issues:**
- **Line ~266**: Polls for new messages every **3 seconds**
- Runs on **EVERY screen** simultaneously

### 3. Storage Change Subscriptions
**Found in ALL major screens** - each subscribes to storage changes:

| Screen | Collections Watched | Frequency |
|--------|-------------------|-----------|
| DashboardScreen | 13 collections | Real-time |
| ProjectsScreen | 7 collections | Real-time |
| VolunteerDashboardScreen | 10+ collections | Real-time |
| MappingScreen | 5 collections | Real-time |
| ProjectLifecycleScreen | 8+ collections | Real-time |
| CommunicationHubScreen | Multiple | Real-time + 5s poll |

## Why Data Fetching is Slow

### Problem 1: Too Many Simultaneous Subscriptions
- **Every screen** subscribes to storage changes
- When ONE piece of data changes (e.g., a message), **ALL subscribed screens** refresh
- Example: Sending 1 message triggers 10+ screens to reload their data

### Problem 2: Redundant Polling
- Communication Hub polls every 5 seconds
- Notification banner polls every 3 seconds  
- Direct messages poll every 1 second
- **All running at the same time!**

### Problem 3: WebSocket + Polling Overlap
- You have BOTH WebSocket subscriptions AND polling intervals
- When WebSocket delivers data instantly, the poll still runs 1-5 seconds later
- This causes **double refreshes**

### Problem 4: No Debouncing/Throttling
- Multiple rapid changes trigger multiple refreshes
- No delay between storage change → screen refresh
- Can cause 5-10 refreshes in 1 second

## Performance Impact

### Network Overhead
```
Per minute with ALL screens active:
- Notification poll: 20 requests (every 3s)
- Proposal poll: 12 requests (every 5s) 
- Direct messages poll: 60 requests (every 1s)
- Storage change triggers: Variable (10-50+)
= 100-150+ requests per minute 🔥
```

### Database Load
- Each request queries multiple collections
- No caching between requests
- Supabase connection pool fills up quickly

## Recommended Fixes

### Priority 1: Increase Poll Intervals ⚡

**Communication Hub (`CommunicationHubScreen.tsx`)**
```typescript
// Line ~239: BEFORE
const DIRECT_BACKEND_MESSAGE_POLL_MS = 1000; // ❌ Too frequent!

// AFTER
const DIRECT_BACKEND_MESSAGE_POLL_MS = 5000; // ✅ Every 5 seconds
```

```typescript
// Line ~1357: BEFORE
const pollTimer = setInterval(() => {
  void loadData(true);
}, 5000); // ❌ Still polling even with WebSocket

// AFTER
const pollTimer = setInterval(() => {
  void loadData(true);
}, 15000); // ✅ Every 15 seconds (WebSocket handles real-time)
```

**Notification Banner (`InAppNotificationBanner.tsx`)**
```typescript
// Line ~266: BEFORE
const interval = setInterval(() => {
  void checkRecentMessages();
}, 3000); // ❌ Too frequent

// AFTER
const interval = setInterval(() => {
  void checkRecentMessages();
}, 10000); // ✅ Every 10 seconds
```

### Priority 2: Add Debouncing 🎯

```typescript
// Add to storage.ts
let debounceTimer: NodeJS.Timeout | null = null;

function debounceStorageChange(callback: () => void, delay = 500) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(callback, delay);
}

// Use in subscriptions
subscribeToStorageChanges(['messages'], () => {
  debounceStorageChange(() => {
    void loadData();
  });
});
```

### Priority 3: Conditional Polling 🔄

Only poll when:
- WebSocket is disconnected
- Screen is focused/visible
- User is actively chatting

```typescript
// Line ~1357: ADD condition
const pollTimer = setInterval(() => {
  // Only poll if WebSocket isn't connected
  if (!isWebSocketConnected) {
    void loadData(true);
  }
}, 15000);
```

### Priority 4: Reduce Subscription Scope 📉

Instead of subscribing to ALL collections on every screen:
```typescript
// BEFORE: Subscribe to everything
subscribeToStorageChanges([
  'projects', 'events', 'volunteers', 
  'messages', 'reports', 'applications'
], loadData);

// AFTER: Only subscribe to what THIS screen displays
subscribeToStorageChanges([
  'messages' // Only messages for Communication Hub
], loadData);
```

### Priority 5: Smart Caching 💾

Add caching with TTL (Time To Live):
```typescript
const CACHE_TTL_MS = 10000; // 10 seconds
let lastFetch = 0;
let cachedData: any = null;

async function loadDataWithCache() {
  const now = Date.now();
  if (cachedData && (now - lastFetch) < CACHE_TTL_MS) {
    return cachedData; // Use cache
  }
  
  cachedData = await fetchFromDatabase();
  lastFetch = now;
  return cachedData;
}
```

## Quick Wins (Implement First)

### 1. Increase Communication Hub Intervals
**File:** `screens/CommunicationHubScreen.tsx`
- Line 239: Change `1000` → `5000`
- Line 1357: Change `5000` → `15000`

### 2. Increase Notification Poll
**File:** `components/InAppNotificationBanner.tsx`
- Line 266: Change `3000` → `10000`

### 3. Add Cleanup When Screen Unfocused
Ensure `clearInterval` runs when users leave screens

## Expected Improvements

After implementing Priority 1 & 2:
- ✅ **80% reduction** in API calls
- ✅ **50% faster** perceived load times
- ✅ **No more** connection pool exhaustion
- ✅ Smoother UI (fewer re-renders)

## Testing Checklist

After changes:
- [ ] Open Communication Hub → Check messages load within 2 seconds
- [ ] Send a message → Check it appears within 3 seconds (WebSocket) or 10 seconds (fallback poll)
- [ ] Leave screen for 30 seconds → Check polling stops
- [ ] Open multiple screens → Check network tab shows reduced requests
- [ ] Check console for `max clients reached` errors (should be gone)
