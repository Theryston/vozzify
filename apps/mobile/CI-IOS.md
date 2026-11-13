# iOS simulator CI

The `Mobile iOS simulator` workflow checks pull request file changes before
starting the macOS job. It includes the mobile app, shared design tokens and
contracts, workspace dependency files, root build/test configuration and the
native workflow definitions. Isolated changes to other apps or packages do not
start the simulator job. It also supports manual runs from the Actions tab
with `workflow_dispatch`.

The workflow uses a standard `macos-26` GitHub-hosted runner. It installs the
locked workspace with Nub, generates the iOS project, installs CocoaPods,
compiles the preview variant for an iOS simulator, boots the selected
available iPhone simulator, installs and launches the app, then runs Maestro
2.12.0. Separate workflow
steps report project generation, dependency installation, compilation,
simulator startup, app installation and smoke execution. The JUnit result is
retained for one day. On flow failure, Maestro's command data, hierarchy,
screenshots and debug log are uploaded when their combined size is at most 10
MiB, also for one day. A simulator screenshot is added when the gallery flow
fails.
The shared flow in `.maestro/flows/gallery-smoke.yaml` checks app launch,
gallery navigation, text entry, overlay interaction, appearance and language
selection, and restoration of the selected appearance and language after an
app restart.

The check does not use EAS or require Apple Developer membership, signing,
TestFlight or paid services. It validates a simulator build only; it does not
validate physical iPhones, distribution builds or store signing. The standard
GitHub-hosted runner quota and artifact limits still apply. A JavaScript export
does not satisfy the native build check.

To run the same native check manually, use the Actions tab and select
`Mobile iOS simulator` → `Run workflow`. The run uses no EAS quota. For a local
simulator build, use macOS with Xcode and CocoaPods installed, then from the
repository root run:

```sh
nub install --frozen-lockfile
cd apps/mobile
export APP_VARIANT=preview
export EXPO_PUBLIC_API_URL=http://127.0.0.1:3333
nub exec expo prebuild --clean --no-install --platform ios
./scripts/install-ios-pods.sh
nub exec expo run:ios --configuration Release --no-bundler --device "<available iPhone simulator name>"
maestro test .maestro/flows/gallery-smoke.yaml
```

Keep both environment variables exported through the build and Maestro run so
the installed app uses the preview bundle and API URL. Replace the device
placeholder with an available iPhone simulator name from Xcode.

Maestro CLI and Java 17 or newer are required for the flow. Simulator
availability depends on the installed Xcode runtimes; choose an available
iPhone simulator on the local Mac.
