# Mesh Chat — example app

A BitChat‑style React Native client built entirely on the published
[`react-native-mesh-sdk`](https://www.npmjs.com/package/react-native-mesh-sdk)
package. It demonstrates the same core UX as the native bitchat‑android /
bitchat‑ios apps:

- **Nickname onboarding** before joining the mesh
- **Public mesh chat** — broadcast messages to every nearby peer
- **Peer drawer** — live peer list with connection dot, 🔒 encryption badge, RSSI
- **Private chats** — tap a peer for an end‑to‑end (Noise) encrypted conversation
- **Delivery receipts** — sending / sent / delivered / read glyphs
- **Persistent history** — messages are saved with AsyncStorage and rehydrated on
  launch (the SDK/Core is ephemeral, so the app owns storage). "clear history"
  in the debug panel wipes it.
- **Notification toggles** — drawer switches for DM notifications and (opt‑in)
  public‑broadcast notifications, persisted between launches
- **iOS keyboard handling** — input lifts above the keyboard and a "hide
  keyboard" affordance (iOS has no dismiss key)
- **Bluetooth banner** — a tap‑to‑enable prompt when Bluetooth is off
- **Private network** — runs on its own BLE UUID pair via `MeshSdk.setMeshId`,
  isolated from other deployments

The app is plain cross‑platform TypeScript:

| File | Role |
|------|------|
| `App.tsx` | Onboarding + chat shell |
| `src/useMesh.ts` | The single hook driving the mesh (BitChat's `ChatViewModel` equivalent) |
| `src/components/*` | `MessageBubble`, `MessageInput`, `PeerList` |

> Bluetooth mesh needs **two physical devices** — the simulator/emulator has no
> BLE radio.

## Run

```bash
npm install          # pulls react-native-mesh-sdk from npm
```

### Android

```bash
npm run android
```

The SDK **autolinks** — nothing else to wire. Runtime Bluetooth/location
permissions are requested by `src/useMesh.ts`; the manifest permissions come
from the library. `minSdk 26+`.

### iOS

iOS is **not** a CocoaPods autolink — the SDK vendors the bitchat‑ios Core +
SwiftPM packages, which a script wires into the app target:

```bash
npm run setup-ios    # = pod install + node_modules/react-native-mesh-sdk/scripts/setup-ios.rb
npm run ios          # simulator build must be arm64 (Apple Silicon)
```

`Info.plist` already contains the required keys:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Mesh Chat uses Bluetooth to talk to nearby devices offline.</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>Mesh Chat uses Bluetooth to talk to nearby devices offline.</string>
<key>UIBackgroundModes</key>
<array><string>bluetooth-central</string><string>bluetooth-peripheral</string></array>
```

Deep iOS details (SwiftPM packages, arm64‑only simulator, Xcode‑26 debug dylib)
are in the library's
[README → iOS integration](https://github.com/ilpol/react-native-mesh-sdk-port#ios-integration).
Re‑run `npm run setup-ios` after upgrading the SDK.

---

## Troubleshooting (macOS)

### Android Studio can't find `node` (nvm users)

If the IDE build fails with `Cannot run program "node"`, Android Studio (from the
Dock) gets a minimal `PATH` from `launchd` that excludes nvm's node, and RN's
autolinking calls `node` by bare name. Fix (permanent, works from the Dock):

```bash
sudo ln -sf "$(which node)" /usr/local/bin/node
sudo ln -sf "$(which npm)"  /usr/local/bin/npm
sudo launchctl config user path "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# → reboot, then Sync in Android Studio
```

No‑reboot alternative: quit Android Studio and launch its binary from a terminal
that has node on `PATH` (`"/Applications/Android Studio.app/Contents/MacOS/studio" &`).
CLI builds via `npm run android` already work (the terminal has nvm on `PATH`).

### Metro / watchman

Metro needs **watchman** (`brew install watchman`); without it the bundler throws
`EMFILE: too many open files`. If watchman can't start with a
`~/.local/state/watchman … Permission denied` error (root‑owned on some
machines):

```bash
sudo chown -R "$USER" ~/.local/state    # one-time fix, or
export XDG_STATE_HOME=/tmp/wm           # per-shell redirect
```

The same values are set for Xcode build phases in `ios/.xcode.env.local`
(gitignored — machine specific).

### "Unable to load script" on device

Debug builds load JS from Metro. Start it (`npm start`) and, for a USB device,
run `adb reverse tcp:8081 tcp:8081`. For hassle‑free two‑device testing, build a
standalone release APK (`cd android && ./gradlew assembleRelease`) — the JS is
embedded, no Metro needed.
