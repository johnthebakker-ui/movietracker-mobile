# MovieTracker Mobile Context

## Existing production system

- Website: Next.js + TypeScript deployed on Vercel.
- Data and authentication: Supabase PostgreSQL, Auth, MFA, Storage, and RLS.
- Catalog metadata: TMDB, with protected server-side access.
- External ratings: OMDb where available.
- Viewing synchronization: Trakt OAuth and scheduled synchronization.

The mobile application must use the same Supabase project and user accounts. It is a new client, not a replacement backend.

## Main product areas to reproduce

- Email/password and Google authentication, email verification, recovery, and TOTP MFA.
- Discovery, search, country/genre/year filters, trending, releases, and K-Drama discovery.
- Movie, show, season, and episode detail screens.
- Watched/planned/watching/paused/dropped tracking with exact, release, current, or unknown dates.
- Ratings from 1.0–10.0 in 0.1 increments, reviews, favorites, history, lists, and list editing.
- Recommendations, not-interested feedback, profile statistics, calendars, progress, and Trakt integration.
- Right-click web actions become long-press native action sheets on Android.

## Mobile architecture

- React Native and Expo with TypeScript.
- Native screen navigation and deep links under the `movietracker://` scheme.
- Supabase publishable client for authentication and RLS-protected user data.
- Versioned HTTPS endpoints on the Vercel backend for secret-bearing catalog and integration operations.
- Android push notifications through Expo Notifications/FCM in a later milestone.

## Visual direction

Match the website's editorial/cinematic appearance: black and warm off-white surfaces, coral accent, large serif display headings, dense poster grids, restrained borders, immersive artwork, and polished native motion. Do not produce a generic template dashboard.
