<meta name="google-site-verification" content="tw5pjIDYKCrq1QKYBrD5iyV7DXIM4rsHN9d11WlJFe4" />

[한국어](../README.md) | **English** | [中文](docs/readme_zh-cn.md)

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
  [![GitHub downloads](https://img.shields.io/github/downloads/lee-sihun/DmNote/total.svg?logo=github)](https://github.com/lee-sihun/DmNote/releases/download/1.5.0/DM.NOTE.v.1.5.0.zip)
  [![GitHub license](https://img.shields.io/github/license/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/blob/master/LICENSE)
</div>

https://github.com/user-attachments/assets/20fb118d-3982-4925-9004-9ce0936590c2

## 🌟 Overview

**DM Note** is a key viewer program created for use with DJMAX RESPECT V. Built with Tauri and React, it allows you to visually display key inputs during streaming or gameplay video creation with simple setup. Currently, it officially supports Windows 10/11 and macOS environments only. If you are on Linux, we recommend trying the [community fork version](https://github.com/northernorca/DmNote).

[Download DM NOTE v1.5.0](https://github.com/lee-sihun/DmNote/releases/download/1.5.0/DM.NOTE.v.1.5.0.zip)

## ✨ Features

### ⌨️ Keyboard Input & Mapping

- Real-time keyboard input detection and visualization
- Custom key mapping configuration

### 🎨 Key Style Customization

- Grid-based key editing
- Support for image assignment
- Custom CSS support

### 💾 Presets & Settings Management

- Auto-save user settings
- Save/Load presets

### 🖼️ Overlay & Window Management

- Lock window position
- Always on top
- Select resize anchor

### 🌧️ Note Effect (Raining Effect) Customization

- Adjust note effect color, opacity, rounding, speed, and height
- Reverse function

### 🔢 Key Counter

- Real-time display of input counts per key
- Customize counter position, color, and style
- Custom CSS support

### ⚙️ Graphics & Settings

- Multilingual support (Korean, English)
- Graphics rendering options (Direct3D 11/9, OpenGL)
- Reset settings

## 🚀 Development

### Tech Stack

- **Frontend**: React 19 + Typescript + Vite 7
- **Backend**: Tauri
- **Styling**: Tailwind CSS 3
- **Input Detection**: Raw Input API (Windows), Global input events (macOS)
- **Package Manager**: npm

### Folder Structure

```
DmNote/
├─ src/                          # Frontend
│  ├─ renderer/                  # React renderer
│  │  ├─ components/             # UI components
│  │  ├─ hooks/                  # State/sync hooks
│  │  ├─ stores/                 # Zustand stores
│  │  ├─ windows/                # Renderer windows (main/overlay)
│  │  ├─ styles/                 # Global/common styles
│  │  └─ assets/                 # Static resources
│  └─ types/                     # Shared types/schemas
├─ src-tauri/                    # Tauri backend
│  └─ src/                       # Commands, services
├─ package.json                  # Project dependencies and run scripts
├─ tsconfig.json                 # TypeScript config
└─ vite.config.ts                # Vite config
```

### Basic Installation & Run

Enter the following commands in your terminal in order:

```bash
git clone https://github.com/lee-sihun/DmNote.git
cd DmNote
npm install
npm run tauri:dev
```

## 🖼️ Screenshots

<!--img src="assets/2025-08-29_12-07-12.webp" alt="Note Effect" width="700"-->

<img src="assets/IMG_1005.gif" alt="Note Effect" width="700">

<!--img src="assets/1.webp" alt="Key Viewer Demo 1" width="700"-->

<img src="assets/2025-09-20_11-55-17.gif" alt="Key Viewer Demo 2" width="700">

<!--img src="assets/IMG_1008.gif" alt="Key Viewer Demo 3" width="700"-->

<img src="assets/2025-09-20_11-57-38.gif" alt="Key Viewer Demo 4" width="700">

## 📝 Notes

- It may not work properly in full-screen mode for some games. In this case, please use borderless window mode.
- If graphics issues occur, please change the rendering option in the settings.
- You can capture it with a transparent background using OBS Window Capture without chroma key.
- When displaying over a game screen, place it with **Always on top** and enable **Lock Overlay Window**.
- Custom CSS example files are located in the `assets` folder.
- When assigning class names, enter only the name excluding the selector (e.g., `blue` -> o, `.blue` -> x).
- Program default settings are saved in the `store.json` file in the `%appdata%/com.dmnote.desktop` folder.

## 🤝 Contributing

We welcome your contributions! Please check the [Contributing Guide](CONTRIBUTING.md) for details.

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
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/LSVoiid"><img src="https://avatars.githubusercontent.com/u/187824877?v=4?s=100" width="100px;" alt="LSVoiid"/><br /><sub><b>LSVoiid</b></sub></a><br /><a href="#translation-LSVoiid" title="Translation">🌍</a></td>
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

<!--
## 🔜 Updates Planned

- Key input count, input speed visualization
- Simultaneous input interval (ms) display
- Input statistics analysis features
 -->
