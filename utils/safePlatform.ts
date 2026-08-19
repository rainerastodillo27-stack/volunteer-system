// Safe Platform module wrapper that works on web where native-specific modules aren't available

let Platform: any;
try {
  Platform = require('react-native').Platform;
} catch {
  Platform = { OS: 'web' };
}

export const SafePlatform = {
  OS: Platform?.OS || 'web',
  
  select<T>(obj: { web?: T; default?: T; ios?: T; android?: T }): T {
    const os = Platform?.OS || 'web';
    
    if (os === 'web' && obj.web !== undefined) {
      return obj.web;
    }
    
    if (os === 'ios' && obj.ios !== undefined) {
      return obj.ios;
    }
    
    if (os === 'android' && obj.android !== undefined) {
      return obj.android;
    }
    
    return obj.default !== undefined ? obj.default : (obj as any).web;
  }
};

// Default export for easier usage
export default SafePlatform;
