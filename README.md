# MovieTracker Mobile

Independent Expo/React Native application for Android. This project has its own Git history and is ignored by the parent MovieTracker website repository.

## Start locally

```bash
npm install
npm start
```

For an Android emulator:

```bash
npm run android
```

Copy `.env.example` to `.env.local` before connecting authentication and production data. Never add server secrets to this project.

## Moving the project later

Close running Expo processes, then move the complete `mobile-app` directory—including its hidden `.git` directory—to a sibling location such as `Desktop/Movietracker-Mobile`. No import paths currently depend on the parent website directory.
