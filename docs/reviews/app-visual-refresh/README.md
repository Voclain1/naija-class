# Visual review captures

Actual local app renders, 19 October 2026. The dashboard uses synthetic school
figures supplied by Playwright request interception; these are not live school
records. No fixture or demo data was added to application source.

- `desktop-light.png` and `desktop-dark.png`: existing Next dashboard at 1440px.
- `web-phone.png`: the same responsive web page at 390px.
- `expo-web-login.png`: the actual Expo web export sign-in screen at 390px.

The Expo capture is browser evidence only, not Android/iOS device verification.

## Second-pass captures

The captures now show the reference-led revision. `web-phone-viewport.png` is
an actual 390 × 844 Next dashboard viewport. `web-phone.png` includes the full
page. `mobile-menu.png` shows the actual navigation drawer opened using its
existing control. The 320, 390, 430 and 768px layout checks pass without page
overflow or clipped metric values; opening/closing the mobile drawer passes.

`native-component-preview.png` is an **isolated Expo component preview**, using
the same ScreenHeader, StatRow, ActionTile and theme components as the staff
home screen, with synthetic data. It is not a device screenshot or an
authenticated staff-app smoke. Staff sign-in still requires a device lock and
remains unavailable on the web target. The local fixture route was removed
after the export and is not committed or shipped. `expo-web-login.png` is the
actual Expo web sign-in route.
