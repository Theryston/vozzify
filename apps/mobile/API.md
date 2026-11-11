# Native API client

Set `EXPO_PUBLIC_API_URL` before starting Expo or exporting a bundle. Expo
copies the value into the native app at build time, where it is validated as an
HTTP(S) URL; the mobile shell validates the embedded value again at startup.
Copy `.env.example` to `.env` for local Android development. The Android
emulator reaches the host machine through `10.0.2.2`. A physical Android device
needs the computer's LAN IP and must share its network. For a USB-connected
device, `adb reverse tcp:3333 tcp:3333` lets it use `http://127.0.0.1:3333`.

Use `mobileApi` from `src/lib/api/mobile-api.ts` for native requests. It calls
the configured standalone API directly under `/v1`, validates request inputs
when their shared contracts are supplied, and always validates successful
responses with a shared contract schema. Query values omit `null` and
`undefined`; object bodies use JSON, while `FormData` keeps the platform's
multipart boundary. Pass the query function's abort signal through so TanStack
Query can cancel requests it no longer needs.

Structured API errors retain their stable `code`, status and details in a
`MobileHttpError`. Translate that code at the UI boundary; the server's message
is developer information. `MobileApiError` distinguishes network failures,
invalid request configuration/contracts and responses that violate their
contract. Native cancellation keeps the original `AbortError` so query
cancellation remains observable.

`MobileQueryProvider` owns the app's `QueryClient`. It maps React Native's
foreground state to query focus and Expo Network state to query connectivity.
Use TanStack Query for future native data screens; do not add another fetch or
cache mechanism.
