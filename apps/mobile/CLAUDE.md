# Mobile app

Read the root `CLAUDE.md` first. This app is the native Android and iOS client;
the Next.js app remains the web client.

## Commands

From the repository root, use `nub run <task> --filter=mobile` for `lint`,
`check-types`, `test`, `test:cov`, and `build`. For native development, change
to `apps/mobile` and run `nub run start`, `nub run android`, or `nub run ios`.

Expo Go is not used: the app uses a development client so later native modules
fit the same workflow. `nub run build --filter=mobile` exports production
JavaScript bundles for both platforms. It does not compile, install, or launch a
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
