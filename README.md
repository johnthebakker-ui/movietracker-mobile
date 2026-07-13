# MovieTracker Mobile

Independent Expo/React Native application for Android. This project has its own Git history and is ignored by the parent MovieTracker website repository.

The app is a native MovieTracker client with:

- cinematic dark mobile UI matching the website’s phone layout
- native bottom navigation
- real catalog discovery from the deployed MovieTracker API
- encrypted Supabase session persistence backed by the platform keystore
- authenticated recommendation calls using the same Supabase account
- native detail screens, bottom-sheet actions, and recommendation hiding

## Start locally

```bash
npm install
copy .env.example .env
npm run android
```

Fill `.env` with the same public values used by the website:

```env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR-PUBLISHABLE-OR-ANON-KEY
EXPO_PUBLIC_API_URL=https://movietracker-tan.vercel.app
EXPO_PUBLIC_EAS_PROJECT_ID=YOUR-EXPO-PROJECT-UUID
```

Never add service-role keys, TMDB tokens, or other server secrets to this project.

`EXPO_PUBLIC_EAS_PROJECT_ID` is required for Expo push-token registration. Local scheduled release notifications still work without it, but server-initiated delivery does not. Link the app once with `eas init`, then place the resulting project UUID in local/EAS environment settings.

## Release APK

`eas.json` defines an installable production APK profile. EAS manages the production signing credential. For a local release, generate a private upload keystore and point the ignored `android/keystore.properties` file at it; never commit the keystore or passwords. Version `1.0.2` uses Android version code `3`.

## Android Studio workflow

For normal development, start an Android Studio emulator and run:

```bash
npm run android
```

To generate native Android project files for Android Studio:

```bash
npx expo prebuild --platform android
```

Then open the generated `android` folder in Android Studio and run the `app` configuration.

## Moving the project later

Close running Expo processes, then move the complete `mobile-app` directory, including its hidden `.git` directory, to a sibling location such as `Desktop/Movietracker-Mobile`. No import paths currently depend on the parent website directory.
