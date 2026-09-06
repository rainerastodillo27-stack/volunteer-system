/**
 * Modern Design System Theme
 * Foundation-focused green theme with contemporary design
 */

export const ModernTheme = {
  // Primary Colors - Foundation Green palette
  colors: {
    primary: {
      50: '#f0fdf4',
      100: '#dcfce7',
      200: '#bbf7d0',
      300: '#86efac',
      400: '#4ade80',
      500: '#22c55e',  // Main foundation green
      600: '#16a34a',
      700: '#15803d',
      800: '#166534',
      900: '#14532d',
      950: '#052e16',
    },

    // Accent green for highlights
    accent: {
      50: '#f0fdfa',
      100: '#ccfbf1',
      200: '#99f6e4',
      300: '#5eead4',
      400: '#2dd4bf',
      500: '#14b8a6',  // Teal accent
      600: '#0d9488',
      700: '#0f766e',
      800: '#115e59',
      900: '#134e4a',
    },

    // Neutral/Gray - Warm grays for better readability
    neutral: {
      50: '#fafaf9',
      100: '#f5f5f4',
      200: '#e7e5e4',
      300: '#d6d3d1',
      400: '#a8a29e',
      500: '#78716c',
      600: '#57534e',
      700: '#44403c',
      800: '#292524',
      900: '#1c1917',
    },

    // Semantic colors
    success: '#22c55e',    // Green for success
    warning: '#f59e0b',    // Amber for warning
    error: '#ef4444',      // Red for errors
    info: '#06b6d4',       // Cyan for info

    // Status colors (green-themed where appropriate)
    status: {
      planning: '#3b82f6',      // Blue - not started yet
      inProgress: '#22c55e',    // Green - active/ongoing
      onHold: '#f59e0b',        // Amber - paused
      completed: '#10b981',     // Emerald - finished
      cancelled: '#ef4444',     // Red - stopped
    },

    // Background colors
    background: {
      primary: '#ffffff',
      secondary: '#f9fafb',
      tertiary: '#f0fdf4',      // Light green tint
      dark: '#14532d',          // Dark green
      card: '#ffffff',
      hover: '#f0fdf4',         // Light green on hover
    },

    // Text colors
    text: {
      primary: '#1c1917',
      secondary: '#57534e',
      tertiary: '#78716c',
      disabled: '#a8a29e',
      inverse: '#ffffff',
      success: '#15803d',       // Dark green for success text
    },

    // Border colors
    border: {
      light: '#f5f5f4',
      medium: '#e7e5e4',
      strong: '#d6d3d1',
      primary: '#bbf7d0',       // Light green border
    },
  },

  // Typography - Modern, clean font stack
  typography: {
    fontFamily: {
      primary: "'Nunito', sans-serif",
      display: "'Nunito', sans-serif",
      mono: "'Nunito', sans-serif",
    },

    fontSize: {
      xs: 11,
      sm: 13,
      base: 15,
      md: 16,
      lg: 18,
      xl: 20,
      '2xl': 24,
      '3xl': 28,
      '4xl': 32,
      '5xl': 40,
      '6xl': 48,
    },

    fontWeight: {
      light: '300',
      normal: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      extrabold: '800',
      black: '900',
    },

    lineHeight: {
      tight: 1.2,
      snug: 1.35,
      normal: 1.5,
      relaxed: 1.65,
      loose: 1.8,
    },

    letterSpacing: {
      tight: -0.5,
      normal: 0,
      wide: 0.5,
      wider: 1,
    },
  },

  // Spacing - 4px base unit for consistency
  spacing: {
    0: 0,
    0.5: 2,
    1: 4,
    1.5: 6,
    2: 8,
    2.5: 10,
    3: 12,
    3.5: 14,
    4: 16,
    4.5: 18,
    5: 20,
    5.5: 22,
    6: 24,
    7: 28,
    8: 32,
    9: 36,
    10: 40,
    12: 48,
    14: 56,
    16: 64,
    20: 80,
    24: 96,
    32: 128,
  },

  // Border radius - Modern, consistent rounding
  borderRadius: {
    none: 0,
    sm: 6,
    base: 10,
    md: 12,
    lg: 16,
    xl: 20,
    '2xl': 24,
    '3xl': 32,
    full: 9999,
  },

  // Shadows - Subtle, layered depth
  shadows: {
    xs: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.03,
      shadowRadius: 1,
      elevation: 1,
    },
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 2,
    },
    base: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 3,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 6,
    },
    lg: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.12,
      shadowRadius: 20,
      elevation: 10,
    },
    xl: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.15,
      shadowRadius: 32,
      elevation: 16,
    },
  },

  // Animation durations
  animation: {
    instant: 100,
    fast: 200,
    base: 300,
    slow: 400,
    slower: 600,
  },
} as const;

// Helper function to get status color
export function getModernStatusColor(status: string): string {
  const normalizedStatus = status.toLowerCase().replace(/\s+/g, '');

  switch (normalizedStatus) {
    case 'planning':
      return ModernTheme.colors.status.planning;
    case 'inprogress':
      return ModernTheme.colors.status.inProgress;
    case 'onhold':
      return ModernTheme.colors.status.onHold;
    case 'completed':
      return ModernTheme.colors.status.completed;
    case 'cancelled':
      return ModernTheme.colors.status.cancelled;
    default:
      return ModernTheme.colors.neutral[500];
  }
}

// Helper for consistent card styling
export const ModernCard = {
  backgroundColor: ModernTheme.colors.background.card,
  borderRadius: ModernTheme.borderRadius.lg,
  padding: ModernTheme.spacing[6],
  ...ModernTheme.shadows.sm,
  borderWidth: 1,
  borderColor: ModernTheme.colors.border.light,
};

// Helper for modern button styling
export const ModernButton = {
  primary: {
    backgroundColor: ModernTheme.colors.primary[600],
    borderRadius: ModernTheme.borderRadius.base,
    paddingVertical: ModernTheme.spacing[3],
    paddingHorizontal: ModernTheme.spacing[6],
    ...ModernTheme.shadows.sm,
  },
  secondary: {
    backgroundColor: ModernTheme.colors.background.primary,
    borderRadius: ModernTheme.borderRadius.base,
    paddingVertical: ModernTheme.spacing[3],
    paddingHorizontal: ModernTheme.spacing[6],
    borderWidth: 1.5,
    borderColor: ModernTheme.colors.primary[300],
  },
  success: {
    backgroundColor: ModernTheme.colors.primary[500],
    borderRadius: ModernTheme.borderRadius.base,
    paddingVertical: ModernTheme.spacing[3],
    paddingHorizontal: ModernTheme.spacing[6],
    ...ModernTheme.shadows.sm,
  },
  text: {
    primary: {
      color: ModernTheme.colors.text.inverse,
      fontSize: ModernTheme.typography.fontSize.sm,
      fontWeight: ModernTheme.typography.fontWeight.semibold,
      letterSpacing: ModernTheme.typography.letterSpacing.wide,
    },
    secondary: {
      color: ModernTheme.colors.primary[700],
      fontSize: ModernTheme.typography.fontSize.sm,
      fontWeight: ModernTheme.typography.fontWeight.semibold,
    },
  },
};

// Helper for modern input styling
export const ModernInput = {
  backgroundColor: ModernTheme.colors.background.primary,
  borderRadius: ModernTheme.borderRadius.base,
  paddingVertical: ModernTheme.spacing[3],
  paddingHorizontal: ModernTheme.spacing[4],
  borderWidth: 1.5,
  borderColor: ModernTheme.colors.border.medium,
  fontSize: ModernTheme.typography.fontSize.base,
  color: ModernTheme.colors.text.primary,
};

// Helper for modern badge styling
export const ModernBadge = {
  paddingVertical: ModernTheme.spacing[1],
  paddingHorizontal: ModernTheme.spacing[3],
  borderRadius: ModernTheme.borderRadius.full,
  fontSize: ModernTheme.typography.fontSize.xs,
  fontWeight: ModernTheme.typography.fontWeight.bold,
  letterSpacing: ModernTheme.typography.letterSpacing.wide,
};

// Helper for modern section header
export const ModernSectionHeader = {
  fontSize: ModernTheme.typography.fontSize['2xl'],
  fontWeight: ModernTheme.typography.fontWeight.bold,
  color: ModernTheme.colors.text.primary,
  marginBottom: ModernTheme.spacing[4],
  letterSpacing: ModernTheme.typography.letterSpacing.tight,
};

export default ModernTheme;
