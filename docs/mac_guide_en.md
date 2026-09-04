[한국어](mac_guide.md) | **English** | [中文](mac_guide_zh-cn.md)

# macOS Installation and Permission Setup Guide

## 1. Permission Setup

DM NOTE requires two permissions to capture keyboard and mouse input:

### Required Permissions

1. **Accessibility**
2. **Input Monitoring**

### Setup Instructions

When you first run the app, the **Accessibility** permission popup will appear automatically.

**Input Monitoring** permission may not show a popup, so you need to set it up manually:

1. Open **System Settings**
2. Go to **Privacy & Security**
3. Click **Accessibility**
   - Click the `+` icon to add DM NOTE.app
4. Click **Input Monitoring**
   - Click the `+` icon to add DM NOTE.app

### ⚠️ Important: App Restart Required

After granting permissions, you must **completely quit and restart DM NOTE** for the permissions to take effect.

---

## 2. Issues on 1.6.1 or Earlier

> [!WARNING]
> **Versions 1.6.1 and earlier were not signed with an Apple Developer ID or notarized.**
>
> This is caused by the macOS Gatekeeper security policy, and when a new version is installed macOS treats it as a different app, resetting the permissions. These issues are resolved in 2.0.0 and later, so we recommend using the [latest version](https://github.com/DmNote-App/DmNote/releases/latest) unless you have a specific reason not to.

### 2-1. "is damaged and can't be opened" Error After Installing

When you first run the app, you may see the following message:

> **"DM NOTE" is damaged and can't be opened.**

Open **Terminal** and run the following command:

```bash
sudo xattr -cr /Applications/DM\ NOTE.app
```

- Enter your macOS login password when prompted
- Re-launch the app after running the command

### 2-2. Permissions Not Working After an Update

- Key input is not captured even though permissions were previously granted
- DM NOTE permission is already enabled in settings but not working

In this case you must **remove and re-add the existing permissions**:

1. Go to **System Settings** → **Privacy & Security**
2. Open **Accessibility**
   - Select **DM NOTE** and click the `-` icon to remove it
3. Open **Input Monitoring**
   - Select **DM NOTE** and click the `-` icon to remove it
4. **Completely quit DM NOTE**
5. Re-launch DM NOTE and follow the instructions in [1. Permission Setup](#1-permission-setup) to add permissions again
6. Restart the app

---

## Troubleshooting

### Key Input Not Being Captured

1. Verify both permissions (Accessibility + Input Monitoring) are enabled
2. Completely quit and restart the app
3. If you updated from 1.6.1 or earlier, see [2-2. Permissions Not Working After an Update](#2-2-permissions-not-working-after-an-update) above

### App Won't Open

If you are on 1.6.1 or earlier, see [2-1. "is damaged and can't be opened" Error After Installing](#2-1-is-damaged-and-cant-be-opened-error-after-installing) above
