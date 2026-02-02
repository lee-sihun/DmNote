<meta name="google-site-verification" content="tw5pjIDYKCrq1QKYBrD5iyV7DXIM4rsHN9d11WlJFe4" />

[한국어](../README.md) | [English](docs/readme_en.md) | **中文**

<div align="center">
  <img src="../src-tauri/icons/icon.ico" alt="dmnote Logo" width="120" height="120">

  <h1>DM Note</h1>
  
  <p>
    <strong>支持广泛自定义的按键显示程序</strong>
  </p>
  <p>
    <strong>提供用户自定义按键映射与样式、可轻松切换的预设，以及现代化、直观的界面</strong>
  </p>
  
  [![GitHub release](https://img.shields.io/github/release/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/releases)
  [![GitHub downloads](https://img.shields.io/github/downloads/lee-sihun/DmNote/total.svg?logo=github)](https://github.com/lee-sihun/DmNote/releases/download/1.5.0/DM.NOTE.v.1.5.0.zip)
  [![GitHub license](https://img.shields.io/github/license/lee-sihun/DmNote.svg?logo=github)](https://github.com/lee-sihun/DmNote/blob/master/LICENSE)
</div>

https://github.com/user-attachments/assets/20fb118d-3982-4925-9004-9ce0936590c2

## 🌟 概述

**DM Note** 是一款专为配合 DJMAX RESPECT V 使用而创建的按键显示程序. 基于 Tauri 和 React 构建, 它允许您通过简单设置, 在直播或游戏视频创作时可视化显示按键输入. 目前, 它仅官方支持 Windows 10/11 和 macOS 环境. 如果您使用的是 Linux, 我们推荐尝试 [社区分支版本](https://github.com/northernorca/DmNote).

[前往下载 DM NOTE v1.5.0](https://github.com/lee-sihun/DmNote/releases/download/1.5.0/DM.NOTE.v.1.5.0.zip)

## ✨ 功能特性

### ⌨️ 键盘输入 与 映射

- 实时键盘输入检测与可视化
- 自定义按键映射配置

### 🎨 按键样式 自定义

- 基于 网格 的按键编辑
- 支持图片分配
- 自定义 CSS 支持

### 💾 预设 与 设置管理

- 自动保存 用户设置
- 保存/加载 预设

### 🖼️ 覆盖层 与 窗口管理

- 锁定 悬浮窗 位置
- 始终置顶
- 选择调整锚点大小

### 🌧️ 音符键雨 (你没看过冰与火之舞?) 自定义

- 调整音符键雨的颜色、不透明度、圆角、速度和高度
- 反向键雨

### 🔢 按键计数器

- 实时显示 每个按键的输入次数
- 自定义计数器位置、颜色和样式
- 自定义 CSS 支持

### ⚙️ 图层 与 设置

- 多语言支持 (韩文、英文、中文)
- 图层渲染选项 (Direct3D 11/9, OpenGL)
- 重置设置

## 🚀 开发

### 技术结构

- **前端**: React 19 + Typescript + Vite 7
- **后端**: Tauri
- **样式**: Tailwind CSS 3
- **输入检测**: Raw Input API (Windows), 全局输入事件 (macOS)
- **包管理器**: npm

### 文件夹 结构

```
DmNote/
├─ src/                          # 前端
│  ├─ renderer/                  # React 渲染器
│  │  ├─ components/             # UI 组件
│  │  ├─ hooks/                  # 状态/同步钩子
│  │  ├─ stores/                 # Zustand 状态库
│  │  ├─ windows/                # 渲染器窗口 (main/overlay)
│  │  ├─ styles/                 # 全局/通用样式
│  │  └─ assets/                 # 静态资源
│  └─ types/                     # 共享类型/模型
├─ src-tauri/                    # Tauri 后端
│  └─ src/                       # 命令、服务
├─ package.json                  # 项目依赖项 和 运行脚本
├─ tsconfig.json                 # TypeScript 配置
└─ vite.config.ts                # Vite 配置
```

### 基本安装 与 运行

在终端中按顺序输入一下命令:

```bash
git clone https://github.com/lee-sihun/DmNote.git
cd DmNote
npm install
npm run tauri:dev
```

## 🖼️ 截图

<!--img src="assets/2025-08-29_12-07-12.webp" alt="Note Effect" width="700"-->

<img src="assets/IMG_1005.gif" alt="Note Effect" width="700">

<!--img src="assets/1.webp" alt="Key Viewer Demo 1" width="700"-->

<img src="assets/2025-09-20_11-55-17.gif" alt="Key Viewer Demo 2" width="700">

<!--img src="assets/IMG_1008.gif" alt="Key Viewer Demo 3" width="700"-->

<img src="assets/2025-09-20_11-57-38.gif" alt="Key Viewer Demo 4" width="700">

## 📝 注意事项

- 部分游戏的全屏模式下可能无法正常运行, 此情况请使用无边框窗口模式.
- 若出现图形显示问题, 请在设置中更改渲染选项.
- 可通过 OBS窗口捕获 功能录制透明背景画面, 无需使用色度键.
- 在游戏屏幕上显示时, 将其 **置于最顶层** 并启用 **锁定叠加窗口**.
- 自定义 CSS 示例文件位于 `assets` 文件夹中.
- 分配类名时, 只输入名称, 不输入选择器 (例如, `blue` -> o, `.blue` -> x).
- 程序默认设置保存在 `store.json` 文件夹的文件 `%appdata%/com.dmnote.desktop` 中.

## 🤝 贡献指南

我们欢迎各位的贡献！详情请查阅 [贡献指南](CONTRIBUTING.md)

### ✨ 贡献者

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

## 📄 许可证

[GPL-3.0 License Copyright (C) 2024 lee-sihun](https://github.com/lee-sihun/DmNote/blob/master/LICENSE)

## ❤️ 特别致谢!

- [tauri-apps/tauri](https://github.com/tauri-apps/tauri)

<!--
## 🔜 计划更新 内容

- 按键输入次数、输入速度可视化
- 同步输入间隔（毫秒）显示
- 输入数据统计分析功能
 -->
