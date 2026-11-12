# Native app variants and builds

The app has three native identities: development (`Vozzify Dev`,
`com.vozzify.app.dev`), preview (`Vozzify Preview`,
`com.vozzify.app.preview`) and production (`Vozzify`,
`com.vozzify.app`). `APP_VARIANT` selects the identity; the build config writes
that same value beside the validated API URL so the installed app can be
inspected. Invalid variants and API URLs fail during configuration.

For local development, copy `.env.example` to `.env` and set the API address
for the target: Android emulator uses `http://10.0.2.2:3333`; a physical Android
device uses the computer's LAN address. From `apps/mobile`, run
`APP_VARIANT=development nub run start` to start Metro. Native builds use
`APP_VARIANT=development nub run android:variant` or
`APP_VARIANT=development nub run ios:variant`. These scripts run
`expo prebuild --clean` before compiling so native package IDs match the selected
variant. The generated native directories are ignored and may be regenerated
when switching identities. Development and preview use unique identifiers and
can be installed alongside production. Local iOS builds require macOS and
Xcode. An iOS simulator build does not run on an iPhone.

EAS profiles are manual and use the EAS `development`, `preview` and
`production` environments. The production profile remains a store-ready device
build; development and preview iOS profiles explicitly target the simulator.
Define `EXPO_PUBLIC_API_URL` separately in each EAS environment before
requesting a build; this is public app configuration,
not a secret. Do not put credentials or private keys in `EXPO_PUBLIC_*` values.
The EAS project must belong to `@vozzify/vozzify`; check that organization and
project before linking this app. The repository does not create or link an EAS
project automatically. Request free-plan builds with the repository's package
manager, for example from `apps/mobile`:
`nub dlx eas-cli build --platform android --profile development`. EAS custom
worker configs install the pinned Nub CLI and install the workspace with the
root `nub.lock` before native compilation. Use `--profile preview` for an internal APK and
`--profile production` only when preparing a later store publication. EAS
profiles keep iOS outputs simulator-only for development and preview; these are
not iPhone previews. No Apple membership, TestFlight, signing or store upload
is needed for the simulator build. Keep EAS on the free plan: stop if the free
quota or credentials are unavailable; do not enable paid overages or fallback.

`nub run build --filter=mobile` exports the production JavaScript bundle by
default; set `APP_VARIANT` to export another identity. It is not native
compilation or evidence that an app was installed. Record local/EAS native
compilation and device/simulator launches separately.

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
