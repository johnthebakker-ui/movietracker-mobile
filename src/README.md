# Mobile architecture

The mobile application uses a feature-first structure:

- `app/` contains the application coordinator, shared application types, styles, and pure mapping/date utilities.
- `features/` contains user-facing capabilities such as calendar, title details, discovery, library, profile, ratings, reviews, notifications, and settings.
- `components/` contains reusable presentation components shared across features.
- Root `App.tsx` is intentionally only the Expo entry point.

Feature modules own their screens and feature-specific logic. Shared domain helpers stay outside screen components so they can be tested and reused without coupling features back to the root application.
