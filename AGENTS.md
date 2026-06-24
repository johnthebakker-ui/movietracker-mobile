# MovieTracker Mobile

This repository is the independent React Native/Expo Android application for MovieTracker. It must remain separate from the Next.js website repository that currently contains this folder.

## Product direction

- Recreate the website's cinematic visual identity with native React Native components.
- Prefer native navigation, sheets, gestures, lists, image loading, haptics, and animations over WebView pages.
- Share the existing Supabase accounts and data model with the website.
- Use the deployed Vercel application as the protected backend for TMDB, Trakt, recommendations, and operations requiring secrets.
- Preserve dark, light, and system themes and phone-first accessibility.

## Security boundary

- Only `EXPO_PUBLIC_SUPABASE_URL`, the Supabase publishable/anon key, and the public backend URL may be bundled into the application.
- Never place the Supabase service-role key, TMDB token, Trakt client secret, OMDb key, or cron secret in this repository or an `EXPO_PUBLIC_*` variable.
- Store user sessions in secure device storage and rely on Supabase RLS plus authenticated server APIs.

## Repository boundary

This folder has its own `.git` directory. The parent website repository ignores `/mobile-app/`. It can be moved to a sibling folder later without changing its Git history.
