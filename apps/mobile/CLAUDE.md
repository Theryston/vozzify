# Mobile app

Read the root `CLAUDE.md` first. This app is the native Android and iOS client;
the Next.js app remains the web client.

## Commands

From the repository root, use `nub run <task> --filter=mobile` for `lint`,
`check-types`, `test`, `test:cov`, and `build`. For native development, change
to `apps/mobile` and run `nub run start` or the `android:variant` / `ios:variant`
scripts. Those native scripts run a clean prebuild under the selected
`APP_VARIANT` before compiling.

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

Shared colors, typography intent, radii, spacing and motion values come from
`@vozzify/design-tokens`. Use its native adapter or semantic Uniwind classes;
keep font registration, native system bars, elevation and layout in this app.
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
secrets in public app configuration. Keep EAS builds manual and free. EAS custom worker configs install the pinned
Nub CLI and use `nub install --filter=mobile... --frozen-lockfile` before
native compilation. Before
linking an EAS project, verify and reuse `@vozzify/vozzify`; do not create a
second project. Development and preview iOS builds target the simulator only,
which cannot be installed on an iPhone. A JavaScript export does not count as a
native build; report compilation and installed-app evidence separately.
