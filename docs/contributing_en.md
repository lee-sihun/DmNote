**English** | [한국어](../CONTRIBUTING.md)

# Contributing Guide

Thank you for your interest in DM Note! This document provides guidelines for contributing to the project.

## 🎯 Contribution Scope

We welcome all forms of contribution.

### 🔧 Code Contributions

| Type            | Description                                               |
| --------------- | --------------------------------------------------------- |
| 🐛 Bug Fixes    | Analyze and fix reproducible bugs                         |
| ✨ New Features | Implement new features (please discuss in an issue first) |
| ♻️ Refactoring  | Improve code structure and readability                    |
| ⚡ Performance  | Optimize rendering, memory, input latency, etc.           |

### 📄 Non-Code Contributions

| Type             | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| 📝 Documentation | Fix or improve README, guides, API docs, etc.                                |
| 🌍 Translation   | Add new languages or improve existing translations (`src/renderer/locales/`) |
| 🧩 Plugins / CSS | Create and share community plugins or CSS themes                             |

> **Note**: Please open an issue to discuss before working on new features or major changes.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS)
- [Rust](https://www.rust-lang.org/tools/install)
- [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development Setup

```bash
git clone https://github.com/DmNote-App/DmNote.git
cd DmNote
npm install
npm run tauri:dev
```

> On Windows, `tauri:dev` includes ASIO output and therefore requires LLVM (`LIBCLANG_PATH`). To run without LLVM, use `npm run tauri:dev:no-asio`. See the [Windows ASIO Build](readme_en.md#windows-asio-build) section of the README for details.

## 📂 Project Structure

```
src/renderer/          # React Frontend
├── components/        # UI Components
│   ├── main/         # Main window only
│   ├── overlay/      # Overlay window only
│   └── shared/       # Shared components
├── hooks/            # Custom hooks
├── stores/           # Zustand stores
├── utils/            # Utility functions
└── types/            # Shared type definitions

src-tauri/src/         # Rust Backend
├── commands/         # Tauri commands (domain-based subfolders)
├── services/         # Business logic
├── state/            # State management
├── keyboard/         # Keyboard input
└── audio/            # Sound engine
```

### Editor runtime and native state

`src/renderer/editor/runtime/` groups modules by responsibility: `coordinator` owns commit coordination and reconciliation, `projection` computes semantic document changes, `operations` exposes element edits, `intent` resolves targets, `geometry` plans layout, `gesture` owns previews and sessions, and `lifecycle` coordinates flushing and write barriers. Tests stay next to their implementation. Import the owning module directly; avoid a shared barrel that pulls UI stores into the commit engine.

`PropertiesPanel/` groups reusable inputs in `controls`, panel chrome and navigation in `navigation`, selection adapters in `selection`, and plugin settings in `plugin`. Existing `single`, `batch`, and `layer` groups remain. Keep each test with its implementation when moving modules.

`src-tauri/src/state/assets/` owns local asset identity and import helpers. `state/window/` owns platform window integration and panel dragging; `panel_drag/machine.rs` owns gesture state transitions. Document commits, persistence and recovery remain in their existing state modules.

`npm run type-check` also runs `tsconfig.strict.json`. This enables strict checking for shared contracts, editor models, the commit engine, semantic projections and the pure geometry planner, including their imported dependencies. UI integration and test fixtures still use the main configuration. Expand this scope as those areas are migrated; do not suppress errors with non-null assertions or `any`.

## 📌 Coding Rules

### File Naming

| Target           | Convention               | Example              |
| ---------------- | ------------------------ | -------------------- |
| React Components | PascalCase               | `GridBackground.tsx` |
| Hooks            | camelCase + `use` prefix | `useKeyManager.ts`   |
| Zustand Stores   | camelCase + `use` prefix | `useFontStore.ts`    |
| Utilities        | camelCase                | `cubicBezier.ts`     |
| Rust Files       | snake_case               | `app_state.rs`       |

### TypeScript / React

- All new files must be TypeScript (`.ts` / `.tsx`)
- Components use arrow functions with inline Props destructuring
- Components use `export default`, hooks/utilities use named exports

### Rust

- Use `#[tauri::command]` (omit permission attribute — `build.rs` auto-generates it)
- Use sync `fn` by default, `async fn` only when actual await is needed

### Comments

- Write comments in **Korean** (except for technical terms)
- Use keyword/noun style (e.g., `// 카운터 초기화`)
- Omit comments when the code is self-explanatory

### API Documentation

- When changing plugin APIs (`dmn.*`) or Tauri commands, update MDX docs under `docs/content/`
- Reflect changes in both `en/` and `ko/` languages

## ✅ Pre-PR Checklist

### Frontend Changes

```bash
npm run type-check  # Full type check + strict core checks
npm run lint        # Lint
npm run format      # Format
```

### Backend Changes

```bash
cd src-tauri
cargo check         # Compile check
cargo clippy        # Lint
cargo fmt           # Format
```

### API / Backend Changes

- When modifying plugin APIs (`dmn.*`) or Tauri commands, ensure **backward compatibility** so existing plugins and integrations continue to work
- Check if migration logic is needed when changing settings file schemas
- Update MDX docs under `docs/content/` for both `en/` and `ko/`

### General

- Manually verify that existing features still work correctly after your changes
- If the area has tests, ensure all tests pass

## 📨 How to Contribute

1. Open an issue to discuss the proposed changes
2. Fork the repository and create a branch
3. Ensure all items in the checklist above pass
4. Submit a PR

Thank you for contributing! 🙏

> Vibe coding contributions using AI tools are also welcome. Just make sure to thoroughly review the code's behavior and quality before submitting.
