# Machat (Electron)

Run: `npm run start` (or `npx electron .`). Tests: `npm test`.

## Desktop entry (Linux)

`electron/machat.desktop` has `StartupWMClass=machat`, which matches the app name and WM class set in `electron/main.js`, so the dock groups the window under the launcher.

```sh
cp electron/machat.desktop ~/.local/share/applications/
mkdir -p ~/.local/share/icons/hicolor/256x256/apps && cp electron/icon.png ~/.local/share/icons/hicolor/256x256/apps/machat.png
# fix the checkout path in Exec= (add --no-sandbox only if this host needs it), then:
update-desktop-database ~/.local/share/applications
```
