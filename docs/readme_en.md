[한국어](../README.md) | **English** | [中文](readme_zh-cn.md)

<div align="center">
  <img src="../src-tauri/icons/icon.ico" alt="dmnote Logo" width="120" height="120">

  <h1>DM Note</h1>
  
  <p>
    <strong>Key viewer program with extensive customization support</strong>
  </p>
  <p>
    <strong>Offers user-defined key mapping and styling, easily switchable presets, and a modern, intuitive interface.</strong>
  </p>
  
  [![GitHub release](https://img.shields.io/github/release/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/releases)
  [![GitHub downloads](https://img.shields.io/github/downloads/lee-sihun/DmNote/total.svg?logo=github)](https://github.com/lee-sihun/DmNote/releases/download/1.6.0/DM.NOTE.v.1.6.0.zip)
  [![GitHub license](https://img.shields.io/github/license/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/blob/master/LICENSE)
</div>

https://github.com/user-attachments/assets/d2d638b4-5867-4a3e-8710-0fa843eaf236

## 🌟 Overview

**DM Note** is a key viewer program optimized for DJMAX RESPECT V, and can be freely used with any other game. With simple setup, you can visually display key inputs during streaming or gameplay video creation. Currently, it officially supports Windows 10/11 and macOS environments only. If you are on Linux, we recommend trying the [community fork version](https://github.com/northernorca/DmNote).

[Download DM NOTE v1.6.0](https://github.com/lee-sihun/DmNote/releases/download/1.6.0/DM.NOTE.v.1.6.0.zip)

## 🖼️ Screenshots

<img src="assets/image.png" alt="Screenshot" width="700">
<img src="assets/IMG_1005.gif" alt="Note Effect" width="700">

## ✨ Features

### ⌨️ Keyboard Input & Mapping

- Real-time keyboard input detection and visualization
- Custom key mapping configuration

### 🎨 Key Style Customization

- Grid-based key editing
- Support for image assignment

### 🌧️ Note Effect (Raining Effect) Customization

- Note effect style customization
- Track speed, height, and reverse mode support

### 🔢 Key Counter

- Display input counts per key
- Customize counter position, color, and style

### 📊 Input Statistics

- KPS, AVG, MAX, TOTAL statistics display
- KPS graph visualization
- Statistics elements and graph style customization

### 🎵 Key Sound

- Play sound effects on key input
- Custom sound file support

### 🖼️ Overlay & Window Management

- Lock window position & always on top
- Select resize anchor

### 🖥️ OBS Mode

- Compatible with OBS browser source

### 🧩 Custom CSS & Plugin Support

- Fully customizable program interface and overlay styles with custom CSS
- Custom plugin support

### 💾 Presets & Settings Management

- Auto-save user settings
- Save/Load presets

### ⚙️ Other Settings

- Multilingual interface support (Korean, English, Chinese Simplified/Traditional, Russian)
- Shortcut key settings support
- Reset settings and auto-update

## 🚀 Development

### Tech Stack

- **Frontend**: React 19 + Typescript + Vite 7
- **Backend**: Tauri
- **Styling**: Tailwind CSS 3
- **Input Detection**: Raw Input API (Windows), Global input events (macOS)
- **Package Manager**: npm

### Basic Installation & Run

Enter the following commands in your terminal in order:

```bash
git clone https://github.com/lee-sihun/DmNote.git
cd DmNote
npm install
npm run tauri:dev
```

### Windows ASIO Build

On Windows, `npm run tauri:dev` / `npm run tauri:build` include ASIO key sound output by default (the npm scripts enable the `asio-backend` feature).

ASIO-enabled builds require the following in addition to the regular dependencies:

- **LLVM/Clang**: Used by bindgen to generate ASIO header bindings. Install LLVM (`winget install LLVM.LLVM` or `scoop install llvm`) and set the `LIBCLANG_PATH` environment variable to LLVM's `bin` folder.
- **ASIO SDK**: The Steinberg ASIO SDK is vendored in this repository (`src-tauri/vendor/asio-sdk`) and used automatically. No extra setup or network connection is needed; set the `CPAL_ASIO_DIR` environment variable to override it with your own SDK.

To build without ASIO (no LLVM required — handy for contributing), use `npm run tauri:dev:no-asio` / `npm run tauri:build:no-asio`. Plain `cargo check` / `cargo build` in `src-tauri` also exclude ASIO by default; add `--features asio-backend` to cover the ASIO code paths.

> This repository uses the Steinberg ASIO SDK under the GPLv3 option of its dual license. See [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt). _ASIO is a trademark of Steinberg Media Technologies GmbH, registered in Europe and other countries._

## � Notes

- **This program is free to use for streaming or gameplay video production.**
- [macOS installation and permission setup guide](https://github.com/DmNote-App/DmNote/blob/master/docs/mac_guide_en.md)
- Program default settings are saved in the `%appdata%/com.dmnote.desktop` folder.
- If you don't need to check the overlay in real-time and are using it for streaming or gameplay video production, **OBS Mode** is recommended by default. This can reduce the negative impact on game frame rates compared to the regular overlay mode.
- If your gaming PC and streaming/recording PC are separate, we recommend running DM Note on the gaming PC and connecting via OBS browser source on the streaming/recording PC. This can almost completely resolve game frame drop issues caused by the key viewer.
- Even with the **Always on top** feature enabled, the overlay may be hidden behind the game in full-screen mode for some games. In this case, please use borderless window mode.
- Official plugins and CSS example files are included in the `assets.zip` file.
- **Never load untrusted plugins.** When using unofficial plugins, make sure to verify their safety using tools like ChatGPT before use.
- When assigning class names, enter only the name excluding the selector (`blue` ✅, `.blue` ❌)

## 🤝 Contributing

We welcome your contributions! Please check the [Contributing Guide](../CONTRIBUTING.md) for details.

### ✨ Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/lee-sihun"><img src="https://avatars.githubusercontent.com/u/111095268?v=4?s=100" width="100px;" alt="이시훈"/><br /><sub><b>이시훈</b></sub></a><br /><a href="#maintenance-lee-sihun" title="Maintenance">🚧</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/eun-yeon"><img src="https://avatars.githubusercontent.com/u/173552527?v=4?s=100" width="100px;" alt="연우"/><br /><sub><b>연우</b></sub></a><br /><a href="#design-eun-yeon" title="Design">🎨</a> <a href="#ideas-eun-yeon" title="Ideas, Planning, & Feedback">🤔</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/mohong2"><img src="https://avatars.githubusercontent.com/u/150683765?v=4?s=100" width="100px;" alt="mo_hong"/><br /><sub><b>mo_hong</b></sub></a><br /><a href="#translation-mohong2" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/LSVoiid"><img src="https://avatars.githubusercontent.com/u/187824877?v=4?s=100" width="100px;" alt="LSVoiid"/><br /><sub><b>LSVoiid</b></sub></a><br /><a href="#translation-LSVoiid" title="Translation">🌍</a> <a href="https://github.com/DmNote-App/DmNote/commits?author=LSVoiid" title="Documentation">📖</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/kahyou22"><img src="https://avatars.githubusercontent.com/u/136758821?v=4?s=100" width="100px;" alt="문주"/><br /><sub><b>문주</b></sub></a><br /><a href="https://github.com/DmNote-App/DmNote/commits?author=kahyou22" title="Code">💻</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dustingusius"><img src="https://avatars.githubusercontent.com/u/128625716?v=4?s=100" width="100px;" alt="dustingusius"/><br /><sub><b>dustingusius</b></sub></a><br /><a href="#translation-dustingusius" title="Translation">🌍</a></td>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/dotoritos-kim"><img src="https://avatars.githubusercontent.com/u/14037015?v=4?s=100" width="100px;" alt="Dotoritos"/><br /><sub><b>Dotoritos</b></sub></a><br /><a href="https://github.com/DmNote-App/DmNote/commits?author=dotoritos-kim" title="Code">💻</a></td>
    </tr>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/KGH1113"><img src="https://avatars.githubusercontent.com/u/123816263?v=4?s=100" width="100px;" alt="KGH1113"/><br /><sub><b>KGH1113</b></sub></a><br /><a href="https://github.com/DmNote-App/DmNote/commits?author=KGH1113" title="Code">💻</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## 📄 License

[GPL-3.0 License Copyright (C) 2024 lee-sihun](https://github.com/lee-sihun/DmNote/blob/master/LICENSE)

## ❤️ Special Thanks!

- [tauri-apps/tauri](https://github.com/tauri-apps/tauri)
