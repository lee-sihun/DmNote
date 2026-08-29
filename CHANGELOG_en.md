# Changelog

[한국어](https://github.com/DmNote-App/DmNote/blob/main/CHANGELOG.md) | **English**

[2.0.1](#201) · [2.0.0](#200) · [1.6.1](#161) · [1.6.0](#160) · [1.5.2](#152) · [1.5.1](#151) · [1.5.0](#150)

<!-- Release bodies link here with an anchor derived from the version (2.0.1 -> #201).
     Changing the version heading format silently breaks links in existing releases.
     Two-digit segments collide (1.2.10 / 1.21.0 both -> #1210); introduce explicit
     anchors in scripts/build-release-notes.js and the headings if that day comes. -->

---

## [2.0.1](https://github.com/DmNote-App/DmNote/releases/tag/2.0.1)

`2026-08-29`

### Fix

- Fixed stat, graph, knob, and plugin elements on the overlay not receiving the mouse, so they could not be moved or right-clicked
- Fixed hidden keys still showing on the overlay
- Fixed the overlay's mouse hit areas drifting from the actual element positions after a display scale change
- Fixed hit area measurements not recovering once lost, leaving overlay elements unresponsive until the overlay was reopened
- Fixed the app freezing when a popup such as the color picker kept re-anchoring to its trigger
- Fixed the app freezing when a graph repeatedly refreshed the same values
- Fixed the app's glass surfaces disappearing when Windows transparency effects were turned off or battery saver was on

---

## [2.0.0](https://github.com/DmNote-App/DmNote/releases/tag/2.0.0)

`2026-08-29`

### New

#### Redesign and Side Panel

- Redesigned the entire app
  - Pretendard Variable is now the default UI font, with a purple accent and translucent glass surfaces.
  - The main toolbar, properties panel, settings, modals, popups, pickers, and minimap now share one visual and behavioral baseline.
  - The first-run default preset and the default styles for keys, knobs, graphs, stats, counters, and notes have been rebuilt.
  - Replaced the app icon.
  - The new key design was created with inspiration from [@DominoKorean](https://github.com/DominoKorean)'s [custom CSS skins](https://github.com/DominoKorean/DM-Note-skins).

- Moved settings into the Side Panel
  - Sound, font, Custom CSS, and plugin settings are managed on the current screen without a separate manager window.
  - Pickers and editors open as sub-pages inside the panel or as full-screen sheets.
  - Reworked keyboard focus, Tab navigation, Escape behavior, and accessibility labels for popups and modals.

- Added a detachable properties panel
  - Drag the panel header to detach the panel, and bring it back over its original spot in the main window to dock it again.
  - The detached position and state are saved, and the panel follows when the main window is hidden or reopened.
  - Popups, pickers, keyboard focus, live preview, and saving all work the same way in the detached window.
  - `Reset Position` in the grid right-click menu restores the detached panel.

#### Editing and Undo/Redo

- Rebuilt editing on stable element IDs
  - Creating, duplicating, pasting, moving, resizing, or changing properties no longer targets the wrong element.
  - Keys, stats, graphs, knobs, and plugin elements can be selected together to move, resize, toggle visibility, or edit as a group.
  - Multiple changes made during a drag or a batch edit undo and redo as a single step.
  - Edits that mix tab presets, custom tabs, and plugin elements share the same history.
  - Pending edits in every window are saved before the app quits or restarts, and a failed save cancels the quit.

- Simplified element deletion
  - Elements are deleted immediately without a confirmation dialog, and Undo brings them back.

- Improved canvas interaction
  - Double-clicking an element jumps straight to its property editing.
  - Element move drags and the gradient axis handle use pointer capture, so a drag no longer breaks when the cursor leaves the window.
  - Moving several elements at once snaps to the same grid regardless of canvas zoom.
  - Center snapping follows the current grid spacing, and setting `Grid Snap Size` to 0 turns snapping off.
  - Toggle switches can be flipped by dragging the thumb, and a short click is told apart from a drag.
  - Reorganized the grid right-click menu into task groups and submenus.

- Extended numeric inputs
  - Adjust values with the arrow keys, and evaluate expressions using `+`, `-`, `*`, `/`, and parentheses.
  - Drag the label in front of a numeric input left or right to scrub the value.
  - While dragging or holding an arrow key only the display updates, and the value is saved once when the interaction ends.
  - Differing values in a batch edit show as `Mixed`, and in the color picker the opposite axis is locked while one axis is `Mixed`.

#### Multiple Key Bindings

- Bind several inputs to a single key element [Issues 71](https://github.com/DmNote-App/DmNote/issues/71)
  - `Individual` triggers when any one of the bound keys is pressed.
  - `Combined` triggers only while all bound keys are held.
  - Keyboard, mouse, and HID buttons (Windows) can be mixed within the same slot.
  - Add or remove keys and switch the trigger mode directly in the binding popup.
  - [@superalan89](https://github.com/superalan89) suggested [multi-key mapping support](https://github.com/DmNote-App/DmNote/issues/71). 🎉

#### Color, Image, and Font

- Added gradient colors
  - Key, stat, graph, and knob backgrounds and borders, counters, key and stat text, note body and border, and note glow all accept `Solid` or `Gradient`.
  - Switch the type and edit color stops and `Opacity` in the color picker.
  - Drag the axis handle on the canvas to set the gradient direction, on every element except notes.
  - Colors being edited in the picker preview on the canvas right away.
  - `Follow Note Color` makes the glow color track the note body color automatically.

- Unified shadow editing into one control
  - `Color`, `Offset`, and `Blur` are edited in one place, per `Idle` and `Active` state for keys and knobs, and for the `Idle` state on stats.
  - Single and multiple selections are edited the same way.

- Extended Custom Image placement
  - `Replace` mode swaps the key surface and label for the image.
  - `Overlay` mode draws the image as a separate layer on top of the key.
  - Image fit, `Position`, `Rotation`, and `Size` are set per `Idle` and `Active` state.
  - The image picker preview reflects the actual placement and transform.
  - Custom CSS variables can further adjust image fit, transform, and layer order.

- Added Font Weight selection
  - Available weights are detected from local and web fonts and listed for selection.
  - `Font Weight` can be set for keys, stats, and counters, and works alongside the existing Bold setting.
  - Multiple font faces from the same family can be imported through a tab preset.

#### Sound, Font, and Motion Management

- Manage sounds directly from the sound picker
  - `Edit`, `Rename`, `Hide`, `Unhide`, and `Delete` are supported.
  - Trim the playback range in the waveform editor and audition it with Space.
  - Deleting a user sound also safely clears it from any element using it.

- Added system output devices to the `Key Sound Output` list
  - System output devices can be picked directly, and Windows ASIO devices appear in the same list.

- Manage local and web fonts directly from the font picker
  - `Add Font`, `Edit`, `Rename`, `Enable`, and `Delete` are supported.
  - Editing web font CSS shows a live preview of the actual typeface.
  - Images and fonts are loaded by inspecting file contents rather than the extension.

- Reworked the counter motion editor as a full-screen sheet
  - Edit `Scale`, `Duration`, and `Bezier` values against a live key preview.
  - Built-in and user motions share one list, and the add, edit, and delete flow for user motions has been cleaned up.

#### Custom Tabs and CSS

- Flattened the custom tab list inside its popup
  - Tabs can be added, selected, and deleted.

- Per-tab CSS and CSS history
  - Apply a different CSS file per tab and export the current CSS to a file.
  - Reapply a recently loaded CSS file from the history or remove it from the list.

- Scoped Custom CSS in the main window to the grid preview
  - User CSS no longer leaks into settings, the properties panel, popups, or numeric input UI.
  - Hardened CSS handling and URL validation for `@import`, `:is()`, `:where()`, and `@font-face`.

#### Plugin API

- Added the plugin settings Section API
  - Plugins can declare settings sections, input controls, and conditionally visible items that match the app's own UI.

- Extended plugin context menus and display elements
  - Plugin commands can be added to the key and grid right-click menus.
  - Plugin display elements use persistent IDs and can be selected, moved, resized, hidden, and grouped alongside built-in elements.
  - Position and size of plugin elements can be typed in the properties panel or scrubbed from the label.
  - Menu and display element behavior can be defined separately per overlay state.

- Added the plugin Editor API
  - `dmn.editor` reads the current editor document and commits multiple changes atomically.
  - Subscribing to committed changes keeps the main window, overlay, and OBS in sync.
  - Management calls and error contracts for the Resource API and Sound API are now documented.

- Hardened plugin execution and data lifecycle
  - Plugin instances and settings persistence sync against a single backend state.
  - Removing a plugin offers to delete its settings and instance data as well.
  - An explicit `Reload` re-runs plugins even when the file is unchanged.

#### Overlay and Platform

- Added overlay position reset and raised the maximum window size
  - An overlay that ended up off screen returns to the center of the work area on the monitor it overlaps most.

- `Key display delay` can be set up to 30 seconds
  - Input order and note length hold up even when tabs are switched, keys are released, or settings change mid-delay.

- Signed and notarized the macOS app
  - The app is signed with an Apple Developer ID and notarized, so it installs and launches without running `xattr` in the terminal.
  - The signature is now stable, so Accessibility and Input Monitoring permissions carry over across updates from this version on.
  - Upgrading from 1.6.1 or earlier changes the app identity, so both permissions have to be added once more.

- Added Intel Mac support [Issues 125](https://github.com/DmNote-App/DmNote/issues/125)
  - macOS builds are now universal binaries, so the same DMG runs on both Intel and Apple silicon Macs.
  - [@ByrenYan1](https://github.com/ByrenYan1) suggested [Intel Mac support](https://github.com/DmNote-App/DmNote/issues/125). 🎉

- Added support for high refresh rate displays on macOS [Issues 122](https://github.com/DmNote-App/DmNote/issues/122)
  - The overlay and editing screen update more smoothly on 120Hz and faster displays.
  - [@AL-Pinecore](https://github.com/AL-Pinecore) contributed to [high refresh rate display support on macOS](https://github.com/DmNote-App/DmNote/issues/122). 🎉

- Added auto update on macOS
  - Auto update can be turned on or off in settings.
  - Download, verification, install, and restart progress is shown on screen.
  - The install is an atomic replacement, so a failure partway through leaves the existing app intact.

### Fix

#### Saving, Recovery, and Undo/Redo

- Fixed an issue where unsaved counter values reverted to older values during key binding changes, resets, preset loads, and undo/redo
- Fixed an issue where key presses arriving while a counter reset was being saved were lost
- Fixed stalls and out-of-order writes during rapid input by moving editor commits to a FIFO executor off the main thread
- Removed the store lock from the key input path so input and key sound playback are no longer blocked by save work
- Fixed a partial reset by running Reset Data and Reset Tab as a single transaction
- Improved preset import so element IDs, fonts, images, sounds, and CSS paths are safely relinked
- Fixed invalid size values from older presets passing validation
- Corrupted saved data is now recovered item by item, and healthy assets are no longer mistaken for orphans right after a recovery
- Image, sound, and font files are now quarantined in a per-session trash for 30 days instead of being deleted immediately
- Fixed half-written state after a conflict or crash by making save file replacement, asset restore, and failure rollback atomic
- Fixed custom images on knobs disappearing after a restart [Issues 91](https://github.com/DmNote-App/DmNote/issues/91)
  - [@superalan89](https://github.com/superalan89) reported the [missing knob custom image issue](https://github.com/DmNote-App/DmNote/issues/91). 🎉
- Fixed an issue where older undo/redo steps revived already-deleted sound, image, counter motion, and plugin references

#### Panel, Popup, and Input

- Fixed the canvas, toolbar, and shortcuts still responding while a modal was open
- Fixed body-portal dropdowns and popups staying on screen when a modal covered them
- Fixed popups running past the screen edge or outside a small window
- Fixed being unable to copy or paste an empty key slot

#### Rendering and Performance

- Fixed keys, counters, notes, and plugin elements appearing at different times when the overlay first opens
- Fixed pressed states and pending key and counter updates being lost during input mode switches and overlay resync
- Reduced redundant layers and subscriptions for inside counters and moved the counter pop motion to a compositor animation
- Fixed blurred and clipped edges by rendering the note canvas at display scale and reserving a minimum anti-aliasing area
- Reduced latency during fast interaction by batching grid move, resize, marquee, minimap, color track, waveform, and panel input per frame
- Settings, tabs, toggles, dropdowns, modals, and popups now paint their visual state immediately after user input
- Lowered the minimum note corner radius to 0 and changed the default `Glow Size` to 10
- Fixed short notes disappearing abruptly or looking cut off at the display boundary
- Reduced key event delivery latency by enabling low-latency transmission on the OBS WebSocket [Issues 72](https://github.com/DmNote-App/DmNote/issues/72)
  - [@aigonanMTE](https://github.com/aigonanMTE) reported the [OBS mode key viewer stutter issue](https://github.com/DmNote-App/DmNote/issues/72). 🎉

#### Color, Image, Font, and CSS

- Fixed the whole key going blank, or the wrong image being reported as the failure, when an image was corrupted or failed to load
- GIFs are now stored in their original format instead of being converted to WebP
- Fonts with unreadable names now fall back to the file name so they can still be loaded
- Fixed watcher registration and app startup failing because of a CSS file that had already been deleted

#### Plugins and OBS

- Fixed plugin JavaScript failures being reported as success, and truncated error messages
- Fixed the pressed state in the key viewer flickering every time a plugin updated its state [Issues 111](https://github.com/DmNote-App/DmNote/issues/111)
  - [@hjg-06](https://github.com/hjg-06) contributed to [pressed-state flicker on plugin state updates](https://github.com/DmNote-App/DmNote/issues/111). 🎉
- Fixed an exception in a plugin's `onMount` blanking the entire overlay
- Fixed late writes from a failed or removed plugin overwriting the new run state
- Restored compatibility for native `window` methods, async context, and existing global APIs used by plugins
- Fixed leftover side effects and data when adding, removing, or reloading plugins
- Consolidated OBS event forwarding and hardened the command allowlist and protocol version check

#### OS and App Lifecycle

- Fixed the overlay visibility state changing after an app restart on Windows
- Fixed the overlay on macOS not reaching the top of the screen and leaving empty space below it [Issues 121](https://github.com/DmNote-App/DmNote/issues/121)
  - `Snap to Edge` now measures from the screen edge instead of the work area, removing the gap left by the Dock and the taskbar
  - The track height reserved at the top is excluded from the window height when note effects are off
  - [@AL-Pinecore](https://github.com/AL-Pinecore) contributed to the [macOS overlay placement issue](https://github.com/DmNote-App/DmNote/issues/121). 🎉
- Added a quit item to the macOS app menu and stabilized Dock quit, restart, and helper process cleanup
- macOS no longer raises the accessibility permission prompt on its own while the app is running
- Fixed cancellations being reported as failures and the UI blocking by making file and preset dialogs async and parented to the calling window
- Removed the leading silence from the built-in `하잇` key sound
- Other bug fixes

### Etc

- Counter outline settings are no longer supported. Existing data is migrated automatically with the outline values removed.
- Presets and saved data from 1.6.1 are migrated on launch to the new editor document, stable IDs, and default style format.
- Documentation for Custom CSS, the plugin Editor API, Resource API, Sound API, multiple key bindings, image layers, and the overlay API has been updated in both Korean and English.
- For Linux users, the [community fork](https://github.com/northernorca/DmNote) is recommended
- Windows builds include the Steinberg ASIO SDK (GPLv3) · [Third-party notices](https://github.com/DmNote-App/DmNote/blob/main/THIRD_PARTY_NOTICES.txt) · ASIO is a trademark of Steinberg Media Technologies GmbH.

---

## [1.6.1](https://github.com/DmNote-App/DmNote/releases/tag/1.6.1)

`2026-07-05`

### New
#### Added HID and Knob Support
- Added HID device support (Windows)
  - Added HID device support on Windows.
  - Rotation (axis) and button inputs are recognized on devices with knobs/scratches, such as SDVX and DJ DAO controllers.
  - HID device buttons can be mapped to key elements just like keyboard/mouse inputs.

- Added Knob Element
  - A knob element that visualizes rotation input can be added via `Add Knob` in the grid right-click menu.
  - Knob mapping, sensitivity, custom styles, and more can be configured in the properties panel.

Thanks to [블랙워터](https://blog.naver.com/superalan/221006691696) for helping test HID devices and the knob element. 🙏

- Added ASIO Output Support for Key Sounds (Windows)
  - Added the ability to select the key sound output device on Windows.
  - Using an ASIO device allows key sounds to play with lower latency.

- Key Sound Improvements
  - Added 2 built-in key sounds (`하잇 (RiraN, Negoto Bunnyla)` voice, `클릭음` click sound)
    - Thanks to [RiraN](https://x.com/riranofficial) and [Negoto Bunnyla](https://x.com/negotobunny_la) for providing the `하잇 (RiraN, Negoto Bunnyla)` voice file. 🙏
  - Key sound volume can now be set up to 200%.

- Added Decimal Input for Note Values
  - Decimal input is now supported for numeric note values such as note size and border width.

### Fix
- Fixed an issue on macOS where the app crashed or the overlay was not restored when exiting OBS mode [Issues 67](https://github.com/DmNote-App/DmNote/issues/67)
- Fixed an issue where plugin elements were not rendered in OBS mode [Issues 70](https://github.com/DmNote-App/DmNote/issues/70)
  - Improved plugin display elements and their state to resynchronize correctly when OBS reconnects
- Fixed an issue where long note display length was clipped in `Enforce short-note length` mode [Issues 78](https://github.com/DmNote-App/DmNote/issues/78)
  - [@engp114](https://github.com/engp114) contributed to the [short-note length consistency bug](https://github.com/DmNote-App/DmNote/issues/78). 🎉
- Fixed note border color and time resolution issues [Issues 81](https://github.com/DmNote-App/DmNote/issues/81)
  - Fixed an issue where note time resolution depended on monitor refresh rate and OBS fps, causing inaccurate note lengths
  - Fixed an issue where note border opacity depended on note background opacity and could not be configured independently
  - Fixed a bug where border color was not displayed or previewed correctly when batch-selecting notes
  - [@wtre](https://github.com/wtre) contributed to the [note border color and time resolution issues](https://github.com/DmNote-App/DmNote/issues/81). 🎉
- Fixed an issue on macOS where keypad (numpad) key labels were not displayed correctly
  - [@KGH1113](https://github.com/KGH1113) contributed to [macOS keypad key label handling](https://github.com/DmNote-App/DmNote/pull/83). 🎉
- Fixed an issue where the overlay window disappeared when toggling the `Lock Overlay Window` or `Always on Top` option
- Fixed a bug where note effects lingered instead of disappearing when switching tabs
- Fixed an issue where clicking the empty area to the right of a name in the sound list did not open the editor
- Other bug fixes

### Etc
- Improved key sound settings UI and some design elements
- [macOS Installation and Permission Setup Guide](https://github.com/DmNote-App/DmNote/blob/main/docs/mac_guide.md)
  - For Linux users, the [community fork](https://github.com/northernorca/DmNote) is recommended
- Windows builds include the Steinberg ASIO SDK (GPLv3) · [Third-party notices](https://github.com/DmNote-App/DmNote/blob/main/THIRD_PARTY_NOTICES.txt) · ASIO is a trademark of Steinberg Media Technologies GmbH.

---

## [1.6.0](https://github.com/DmNote-App/DmNote/releases/tag/1.6.0)

`2026-03-19`

### New
- Added OBS Mode
  - Added the ability to use overlay features through OBS browser sources.
  - If you don't need to view the overlay in real-time and are using it for streaming or gameplay recording, OBS mode is generally recommended. It reduces the negative impact on game frame rates compared to the standard overlay mode.
  - If your gaming PC and streaming/recording PC are separate, you can run DM Note on the gaming PC and connect via OBS browser source on the streaming/recording PC. This can virtually eliminate game frame drops caused by the key viewer.

- Added Graph Feature
  - The KPS graph previously supported through the `kps.js` plugin has been officially integrated and expanded.
  - Graphs can be added via right-click on the grid or the bottom toolbar.

- Added Counter Motion Feature
  - Counter motion, previously available only for outside counters, now also applies to inside counters.
  - Added the ability to customize motion settings (cubic-bezier, scale, duration).

- Added Key Sound Feature
  - Added the ability to play audio files on key press.
  - Low-latency audio playback implemented using Rust.

- Added Auto Update Feature (Windows only)
  - Added auto update functionality for Windows.
  - Auto update can be enabled or disabled through the Settings window.

- Added Individual Note Settings
  - Added the ability to configure detailed position, alignment, and border properties for individual notes.

- Added Overlay Padding Settings
  - Added the ability to set overlay window padding under the Canvas > Grid tab.

- [Conditional Visibility Support for Plugin Settings Schema](https://github.com/DmNote-App/DmNote/pull/52)
  - [@dotoritos-kim](https://github.com/dotoritos-kim) contributed to [conditional visibility support for plugin settings schema](https://github.com/DmNote-App/DmNote/pull/52). 🎉

- Grid Usability Improvements
  - Added layer grouping feature
    - Select multiple elements on the grid or in the layer panel, then use the right-click context menu or `Ctrl/Command + G` / `Ctrl/Command + Shift + G` shortcuts to group or ungroup elements.
  - Added the ability to rename objects (keys, stats, graphs, plugins, groups)

- Preset Improvements
  - Added the ability to export or import the current tab as a preset
  - Added preset loading to the grid undo/redo cycle

- Bottom Toolbar Improvements
  - Added stat and graph element support to the delete and add tools
  - Moved the existing `Etc > Note Settings` to `Track Settings` in the bottom toolbar

- Track Settings (formerly Note Settings) Improvements
  - Renamed from `Etc > Note Settings` to `Track Settings` and made it directly accessible from the bottom toolbar to reduce confusion.
  - Independent track settings can now be applied per tab.
  - Fade values can now be configured directly.

### Fix
- Fixed a bug where element placement became abnormal when using spacing and size adjustment features
- Fixed list popup size errors
- Fixed a bug where undo/redo history stacked 2–3 times for some properties during batch editing
- Added stat, graph, and plugin elements to the note effect Y-axis calculation logic
- Fixed a bug where overlay window position was not restored correctly on restart when positioned outside the screen
- Fixed clipping of text on key and stat elements at the top and bottom
- Fixed a memory leak bug (Private Bytes 202.6 MB → 7.3 MB, binary size reduced by ~2 MB)
- Other bug fixes

### Etc
- [@dotoritos-kim](https://github.com/dotoritos-kim) contributed an example plugin using a bridge server ([DmNote-BMS-Plugin](https://github.com/dotoritos-kim/DmNote-BMS-Plugin)). 🎉
- HID device support is planned for the future. If you own a relevant device (SDVX controller, DJ DAO, BT controller, or other devices with knobs/scratches) and can help with testing, please contact us at [info@dmnote.app](mailto:info@dmnote.app).
- Performance optimizations and improvements to some design elements
- Administrator privileges enabled by default on Windows
- [macOS Installation and Permission Setup Guide](https://github.com/DmNote-App/DmNote/blob/main/docs/mac_guide.md)
  - For Linux users, the [community fork](https://github.com/northernorca/DmNote) is recommended

---

## [1.5.2](https://github.com/DmNote-App/DmNote/releases/tag/1.5.2)

`2026-02-17`

### New
- Grid Editing Improvements
  - Added decimal support for `X`, `Y`, `W`, and `H` properties on key, stat, and plugin elements
  - Improved visual quality of placed elements when using zoom on the grid
  - Added Spacing Editor
    - Added the ability to select multiple elements by drag or `Ctrl/Command + click` and batch-edit spacing between elements

- Added Tray Mode Support
  - When `Enable tray mode` is enabled in Settings, clicking the close button will only close the Settings window
  - The Settings window can be reopened or the app can be quit from the tray icon (Windows taskbar / macOS menu bar)

- Added Overlay Context Menu
  - Added a right-click menu in the overlay window when `Lock Overlay Window` is disabled
  - Added an `Always on Top` toggle and options for `Select Tab`, `Close Overlay`, `Settings`, and `Quit Application`
  - Added `Snap to Edge` to snap the overlay window to the nearest screen edge

- Integrated Experimental Features into Note Settings
  - Moved existing experimental feature settings to the Advanced tab in Note Settings

- Added Russian Interface Support
  - [@dustingusius](https://github.com/dustingusius) contributed to [Russian interface translation support](https://github.com/DmNote-App/DmNote/issues/33). 🎉

### Fix
- Fixed a bug where event limiting during key mapping did not work correctly in some environments
- Fixed an issue on macOS where the overlay did not appear above fullscreen apps even with `Always on Top` enabled
- Fixed slight vertical alignment issues in key/stat elements
- Fixed slight clipping at the edge of some fonts in key/stat elements
- Fixed a bug where the Add Tab modal closed automatically [Issues 32](https://github.com/DmNote-App/DmNote/issues/32), [Issues 35](https://github.com/DmNote-App/DmNote/issues/35)
- Fixed a bug where arrow key mapping did not work correctly on some Windows environments [Issues 33](https://github.com/DmNote-App/DmNote/issues/33)
- Fixed a freeze when changing gradient colors in the color picker during multi-edit
- Fixed a bug where UI was clipped in some environments [Issues 25](https://github.com/DmNote-App/DmNote/issues/25)

### Etc
- Note effect performance optimizations
- Increased the maximum number of additional tabs (5 → 30)
- Improved some default settings and UI design
- [macOS Installation and Permission Setup Guide](https://github.com/DmNote-App/DmNote/blob/main/docs/mac_guide.md)
  - For Linux users, the [community fork](https://github.com/northernorca/DmNote) is recommended

---

## [1.5.1](https://github.com/DmNote-App/DmNote/releases/tag/1.5.1)

`2026-02-07`

### New
- Added Stat Element
  - Stat elements can be added via `Add Stat` from the grid context menu
  - Allows placing and monitoring `Kps, Kps AVG, Kps Max, Total` statistics on the canvas
  - The `Total` stat only counts while the counter option is enabled
  - Stat elements support individual styling and can be batch-edited together with key elements
  - Added plugin [Stats API](https://dmnote.app/en/docs/api-reference/keys/#stats-api)

- Added Font Settings
  - Added the ability to set fonts for key and stat elements without CSS
  - Both web fonts and local fonts are supported

- Added Counter Alignment Option
  - The alignment layout for counters on key and stat elements can now be configured

- (Experimental) Added Note Effect Frame Limit Option
  - Added a setting to limit the frame rate of note effects
  - Setting it to 0 (default) removes the frame limit

- Added Simplified and Traditional Chinese Interface Support
  - [@mohong2](https://github.com/mohong2) contributed [Traditional Chinese interface translation](https://github.com/DmNote-App/DmNote/pull/26). 🎉
  - [@LSVoiid](https://github.com/LSVoiid) contributed [Simplified Chinese interface and README translation](https://github.com/DmNote-App/DmNote/pull/28). 🎉

### Fix
- Fixed [a bug where the overlay window did not appear transparent](https://github.com/DmNote-App/DmNote/issues/20) after Microsoft Edge Runtime 145.x
- Fixed a bug where border and corner radius styles were not properly applied when assigning an image to a key element
- Fixed an issue where editing lag increased as more keys with assigned images were present on the grid
- Performance optimizations for keys with assigned `.gif` files

### Etc
- Added official macOS (arm64) support
  - [macOS Installation and Permission Setup Guide](https://github.com/DmNote-App/DmNote/blob/main/docs/mac_guide_en.md)
  - For Linux users, the [community fork](https://github.com/northernorca/DmNote) is recommended
- Note effect performance optimizations

---

## [1.5.0](https://github.com/DmNote-App/DmNote/releases/tag/1.5.0)

`2026-01-24`

### New
- Added Side Panel
  - Switched the design editing interface from a modal to a side panel.
  - The default display for settings windows created using `defineElement` and `defineSettings` has been changed from a modal to a side panel. The existing modal style is still supported via the `settingUI` value. [Related Docs](https://dmnote.app/docs/declarative-api/)
  - Added canvas editing features
    - You can now reorder elements or toggle their visibility by dragging them in the Layers tab.
    - Moved the existing `Other Settings - Grid Settings` to the Grid tab and added new settings to control grid snap size and toggle the minimap.

- Added Multi-Edit Feature
  - You can now select multiple keys at once and edit them collectively.

- Added Key Customization Features
  - Added the ability to edit key background color, border color, border thickness, corner radius, text, font size, font color, and font style without CSS. Enabling "Prioritize Inline Styles" ensures these settings take precedence over conflicting CSS.
  - Added the ability to set the width and corner radius of individual notes.
  - Added the ability to edit the font size and font style of counters without CSS.

- Global Note Settings Changes
  - The corner radius setting has been moved to individual key settings.
  - Added a `None` option to the Fade settings.

- Added Shortcut Settings
  - Added the ability to configure the program's main shortcuts. This is located under the Language settings.
  - You can right-click a shortcut button to unbind it.

- Canvas Improvements
  - Hold `Shift` while dragging a key or plugin element to maintain its aspect ratio.

### Fix
- Changed some default settings

### Etc
- Performance optimizations and improvements to some design elements
- The program now automatically applies the browser's language setting upon first launch.
- A bug was discovered in Microsoft Edge Runtime 145.x and later where transparent overlays appear gray or white. As this bug severely impacts program usability, an older version of the WebView2 runtime has been temporarily embedded in the program files, resulting in an increased file size. Once the WebView2 issue is resolved, we will switch back to the previous method in the next minor update, reducing the file size. [Related Issue](https://github.com/DmNote-App/DmNote/issues/20)

---

## 1.4.1 and earlier

English release notes were not published for these versions. The original Korean notes are in [CHANGELOG.md](CHANGELOG.md).

| Version | Date | Notes |
| --- | --- | --- |
| [1.4.1](https://github.com/DmNote-App/DmNote/releases/tag/1.4.1) | 2026-01-05 | [한국어](CHANGELOG.md#141) |
| [1.4.0](https://github.com/DmNote-App/DmNote/releases/tag/1.4.0) | 2025-12-09 | [한국어](CHANGELOG.md#140) |
| [1.3.0](https://github.com/DmNote-App/DmNote/releases/tag/1.3.0) | 2025-10-18 | [한국어](CHANGELOG.md#130) |
| [1.2.1](https://github.com/DmNote-App/DmNote/releases/tag/1.2.1) | 2025-10-01 | [한국어](CHANGELOG.md#121) |
| [1.2.0](https://github.com/DmNote-App/DmNote/releases/tag/1.2.0) | 2025-09-20 | [한국어](CHANGELOG.md#120) |
| [1.1.0](https://github.com/DmNote-App/DmNote/releases/tag/1.1.0) | 2025-09-03 | [한국어](CHANGELOG.md#110) |
| [1.0.5](https://github.com/DmNote-App/DmNote/releases/tag/1.0.5) | 2025-06-03 | [한국어](CHANGELOG.md#105) |
| [1.0.4](https://github.com/DmNote-App/DmNote/releases/tag/1.0.4) | 2025-01-24 | [한국어](CHANGELOG.md#104) |
| [1.0.3](https://github.com/DmNote-App/DmNote/releases/tag/1.0.3) | 2025-01-23 | [한국어](CHANGELOG.md#103) |
| [1.0.2](https://github.com/DmNote-App/DmNote/releases/tag/1.0.2) | 2025-01-22 | [한국어](CHANGELOG.md#102) |
| [1.0.1](https://github.com/DmNote-App/DmNote/releases/tag/1.0.1) | 2025-01-21 | [한국어](CHANGELOG.md#101) |
| [1.0.0](https://github.com/DmNote-App/DmNote/releases/tag/1.0.0) | 2025-01-20 | [한국어](CHANGELOG.md#100) |
