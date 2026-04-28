// Initialize Platform module before any other imports can use it
// This ensures Platform is available on web even though it's not fully implemented

let PlatformModule: any;

try {
  PlatformModule = require('react-native').Platform;
} catch (e) {
  // On web, react-native.Platform may not be fully initialized yet
  // Create a minimal polyfill
  PlatformModule = {
    OS: 'web',
    select: function(obj: any) {
      const os = this.OS;
      if (os === 'web' && obj.web !== undefined) return obj.web;
      if (os === 'ios' && obj.ios !== undefined) return obj.ios;
      if (os === 'android' && obj.android !== undefined) return obj.android;
      return obj.default !== undefined ? obj.default : obj.web;
    }
  };
}

// Make Platform globally available  
(globalThis as any).Platform = PlatformModule;

export {};
