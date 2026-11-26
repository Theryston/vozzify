# Mobile app

Read the root `CLAUDE.md` first. This app is the native Android and iOS client;
the Next.js app remains the web client.

## Commands

From the repository root, use `nub run <task> --filter=mobile` for `lint`,
`check-types`, `test`, `test:cov`, and `build`. For native development, change
to `apps/mobile` and run `nub run start` or the `android:variant` / `ios:variant`
scripts. On a clean checkout, run `nub run --filter=@vozzify/contracts build`
first so Metro can read the compiled contracts. Those native scripts run a clean, platform-specific Expo prebuild with `--no-install` under the selected `APP_VARIANT` before compiling. Expo’s iOS run command synchronizes CocoaPods dependencies before launching the simulator.

Expo Go is not used: the app uses a development client so later native modules
fit the same workflow. `nub run build --filter=mobile` exports production
JavaScript bundles for both platforms by default; set `APP_VARIANT` to export a
different identity. It does not compile, install, or launch a
native app. Android launch requires Android Studio/SDK and an emulator or device;
iOS launch requires macOS, Xcode, and an iOS simulator. Record native startup
evidence separately from a JavaScript bundle export.

The foundation uses Expo Router, React Native, Uniwind with Tailwind CSS v4,
React Native Reusables source components, `use-intl`, mobile-owned
`messages/en.json` and `messages/pt-BR.json`, Jest with `jest-expo`, React Native
Testing Library, and the repository's Biome/TypeScript conventions. `en` is
the source of truth. Keep route files thin; generic UI and infrastructure live
under `src/components` and `src/lib`. Add product features only in their later
tickets. Keep native dependencies free and do not enable paid services.

The mobile shell detects the device language on first launch, maps English to
`en` and Portuguese to `pt-BR`, and falls back to `en` for other languages. A
manual selection in the component gallery is stored on the device and takes
precedence on later launches. Keep mobile copy in the mobile catalogs; add
English keys first, then their Brazilian Portuguese translations.

Shared colors, typography intent, radii, spacing and motion values come from
`@vozzify/design-tokens`. Use its native adapter or semantic Uniwind classes;
keep font registration, native system bars, elevation and layout in this app.
The component gallery includes a system/light/dark appearance control. The
choice is stored on-device; system mode clears the app override and follows
subsequent operating-system changes. Keep the launch screen visible until the
saved appearance is restored so the first visible frame uses the selected
palette. Components, navigation, overlays and the status bar follow the same
resolved native color scheme.
If custom fonts fail to load, render with system fonts and release the splash
screen; never keep the launch screen waiting for an optional font asset. Native
floating layers use translucent semantic surfaces and platform elevation; the
web glass utility's backdrop blur is not part of the native adapter.
The web consumes the same source through its generated CSS adapter. When adding
a customized component, follow the small source-first patterns in
`src/components/ui`: add only the React Native Reusables primitives used by
the gallery or feature, use accessible native controls and translated labels,
and place portalled content under the root `PortalHost`.

Protected quality configuration requires explicit approval for each proposed
change. Do not modify coverage thresholds, Biome, Knip, or architecture rules
without presenting the exact change and receiving that approval first.

## App variants

The native app uses development, preview and production identities configured
in `app.config.ts`; select them with `APP_VARIANT`. Each EAS profile selects
its corresponding EAS environment, which must define the public
`EXPO_PUBLIC_API_URL`. Use `.env.example` for local API addressing. Never put
secrets in public app configuration. Keep EAS builds manual and free. EAS custom worker configs install the pinned Nub CLI and use
`nub install --filter=mobile... --frozen-lockfile`, build the shared contracts,
then run platform-specific Expo prebuild with `--no-install` through Nub before
native compilation. Before
linking an EAS project, verify and reuse `@vozzify/vozzify`; do not create a
second project. Development and preview iOS builds target the simulator.
The `preview-device` EAS profile uses the same preview identity and
environment for a signed iPhone build. A JavaScript export does not count as a
native build; report compilation and installed-app evidence separately.

## Native Google sign-in

Configure OAuth in the existing Google Cloud project for each variant that
offers Google sign-in. Register its Android package and the SHA-1 of the
certificate that signs the installed build. Register a separate iOS OAuth
client for its bundle identifier. See `src/lib/config/app-variants.json` for
the three native identities. The Android OAuth client ID is associated with
the package and signature in Google Cloud.

In the corresponding EAS environment (or local build env), set
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the OAuth Web application client ID
used by the native SDK to request ID tokens. Set
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` to the iOS OAuth client ID for that variant.
Expo generates the reversed iOS URL scheme during prebuild. Android needs only
the Web client ID in the app configuration. These IDs are public.

On the API reached by that build, set `GOOGLE_NATIVE_CLIENT_IDS` to the
comma-separated Web/server and iOS client IDs of the builds it accepts. Keep
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` configured for the existing
Better Auth Google provider. The secret stays on the API. Builds with no
Google IDs use the credential forms.

For physical-device QA, install a configured preview APK and use the
`preview-device` profile with existing iOS signing, or prebuild and run the
preview variant from Xcode on an iPhone. On each device, cancel from both
auth forms and confirm the original form and destination stay intact. Then
sign in with a new Google account, confirm Username setup, and sign in with a
returning account to confirm Home or the original destination and pending
action. Android and iOS simulator smoke tests exercise installed builds with
credential auth. They do not run the live Google flow.

## Automatic Android validation

Changes to the mobile app, shared design tokens or contracts, lockfile,
mobile/shared package manifests, Node configuration,
TypeScript/Biome/Knip/test configuration, Turbo configuration and the main CI
workflow run Android native validation on pull requests and pushes to `main`. Other isolated service changes do not trigger it. Use the workflow's
**Run workflow** action to run it manually; manual runs always build and test.

The workflow uses a standard GitHub-hosted Ubuntu runner, the preview app
variant and a locally compiled release APK with its JavaScript bundle
included. It builds the shared contracts, starts an Android emulator and runs
the Maestro smoke flows against the installed APK. It checks gallery navigation, input, overlay,
appearance and language selection, then restarts the app to verify that the
selected appearance and language return. The credential smoke signs in
against the API on the runner with a disposable User, restores the session
mid-onboarding, sets the Username and exercises the Gallery continuation.
The installed test APK allows HTTP only through the emulator loopback using
`adb reverse`. Normal Android builds keep their existing network policy. The
runner opens the APK before Maestro and dismisses the known Pixel Launcher
ANR dialog if it interrupts the emulator startup. The Maestro JUnit report is uploaded
for seven days, including when the smoke test fails. Maestro failure logs,
screenshots and screen hierarchy are uploaded in a separate artifact capped at
10 MiB and retained for one day. It does not use EAS or produce a store-ready
signed build.

To reproduce the build locally, run `nub run --filter=@vozzify/contracts build`,
then run `APP_VARIANT=preview
EXPO_PUBLIC_API_URL=http://10.0.2.2:3333 nub exec expo prebuild --clean
--no-install --platform android` from `apps/mobile`, then run
`./gradlew --no-daemon assembleRelease -PreactNativeArchitectures=x86_64` from
`apps/mobile/android` to match the x86_64 emulator and avoid compiling unused
Android ABIs. Install
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk` on a running
emulator and run `maestro test --format junit --output
apps/mobile/maestro-results.xml apps/mobile/.maestro/flows/gallery-smoke.yaml`
from the repository root. Install the Maestro CLI separately; the CI workflow
pins its CLI release and does not use Maestro Cloud.

The iOS simulator CI workflow, triggers and manual execution are documented in
[`CI-IOS.md`](./CI-IOS.md).
