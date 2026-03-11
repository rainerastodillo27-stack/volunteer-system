# Volunteer Management System

A mobile application built with React Native and Expo that helps manage volunteer activities, projects, and location-based volunteering opportunities.

## Features

- **User Authentication**: Login screen for volunteer access
- **Dashboard**: View volunteer statistics and quick information
- **Projects Management**: Browse and manage volunteer projects with status tracking
- **Location Maps**: View volunteer locations and active campaigns
- **User Profile**: Manage volunteer profile and track volunteer hours

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Expo Go app (download from App Store or Google Play)

### Installation

1. **Install dependencies**:
   ```bash
   cd volunteer-system
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm start
   ```

   This will start the Expo development server and display a QR code in your terminal.

3. **Open with Expo Go**:
   - **iPhone**: Open your iPhone camera, scan the QR code, and tap the notification
   - **Android**: Open the Expo Go app, tap "Scan QR code", and scan the displayed code

### Running on Specific Platforms

```bash
# Run on Android
npm run android

# Run on iOS
npm run ios

# Run on Web
npm run web
```

## Project Structure

```
volunteer-system/
├── App.tsx                      # Main app entry point
├── app.json                     # Expo configuration
├── package.json                 # Project dependencies
├── tsconfig.json               # TypeScript configuration
├── screens/                    # Screen components
│   ├── LoginScreen.tsx         # Login/authentication
│   ├── DashboardScreen.tsx     # Main dashboard
│   ├── ProjectsScreen.tsx      # List of projects
│   ├── MapScreen.tsx           # Location management
│   └── ProfileScreen.tsx       # User profile
├── navigation/                 # Navigation configuration
│   ├── StackNavigator.tsx      # Stack navigation setup
│   └── TabNavigator.tsx        # Tab navigation setup
├── components/                 # Reusable components
│   └── ProjectCard.tsx         # Project card component
└── types/                      # TypeScript type definitions
    └── navigation.ts           # Navigation types
```

## Screens

### Login Screen
- Email and password input
- Login validation
- Sign-up link

### Dashboard
- Volunteer statistics
- Total volunteers count
- Active and completed projects summary

### Projects Screen
- List of all volunteer projects
- Project status (Ongoing, Completed, Planning)
- Volunteer count for each project
- Project descriptions

### Map/Locations Screen
- View volunteer locations
- Active projects by location
- Volunteer count per location
- Location status indicator

### Profile Screen
- Volunteer profile information
- Hours logged tracker
- Projects joined count
- Edit profile option
- Logout functionality

## Technologies Used

- **React Native**: Cross-platform mobile framework
- **Expo**: Development platform and toolchain
- **React Navigation**: Navigation library for React Native
- **TypeScript**: Type-safe JavaScript
- **Ionicons**: Icon library

## Development Tips

### Hot Reload
- Press `r` in the terminal to reload the app
- Press `w` to open web version
- Press `a` for Android
- Press `i` for iOS

### Debugging
- Shake your device or press `Ctrl+M` (Android) or `Cmd+D` (iOS)
- Select "Debug JS Remotely" to use Chrome DevTools

### Adding New Screens
1. Create a new file in the `screens/` folder
2. Add it to the appropriate navigator
3. Update the navigation types if needed

## Building for Production

```bash
# Create an iOS build
eas build --platform ios

# Create an Android build
eas build --platform android

# Create an APK for Android
eas build --platform android --type apk
```

## Future Enhancements

- Database integration for project management
- Push notifications for new volunteer opportunities
- Real-time location tracking
- Volunteer reviews and ratings
- Integration with external APIs
- Offline data synchronization

## License

MIT License - feel free to use this project for educational purposes

## Contributing

Feel free to submit issues, fork the repository, and create pull requests for any improvements.

## Support

For issues or questions, please open an issue on the repository.
