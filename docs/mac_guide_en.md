[한국어](mac_guide.md) | **English** | [中文](mac_guide_zh-cn.md)

# macOS Installation and Permission Setup Guide

## 1. "is damaged and can't be opened" Error

When you first run the app, you may see the following message:

> **"DM NOTE" is damaged and can't be opened.**

### Solution

Open **Terminal** and run the following command:

```bash
sudo xattr -cr /Applications/DM\ NOTE.app
```

- Enter your macOS login password when prompted
- Re-launch the app after running the command

> **Note:** This error occurs due to macOS Gatekeeper security policy when the app is not officially notarized by Apple.

---

## 2. Permission Setup

DM NOTE requires two permissions to capture keyboard and mouse input:

### Required Permissions

1. **Accessibility**
2. **Input Monitoring**

### Setup Instructions

The app does not automatically show the **Accessibility** permission prompt at launch. Configure both permissions, including Input Monitoring, manually:

1. Open **System Settings**
2. Go to **Privacy & Security**
3. Click **Accessibility**
   - Click the `+` icon to add DM NOTE.app
4. Click **Input Monitoring**
   - Click the `+` icon to add DM NOTE.app

### ⚠️ Important: App Restart Required

After granting permissions, you must **completely quit and restart DM NOTE** for the permissions to take effect.

---

## 3. Installing New Versions

When installing a new version of DM NOTE, permissions may stop working.

### Symptoms

- Key input is not captured even though permissions were previously granted
- DM NOTE permission is already enabled in settings but not working

### Solution

After installing a new version, you must **remove and re-add the existing permissions**:

1. Go to **System Settings** → **Privacy & Security**
2. Open **Accessibility**
   - Select **DM NOTE** and click the `-` icon to remove it
3. Open **Input Monitoring**
   - Select **DM NOTE** and click the `-` icon to remove it
4. **Completely quit DM NOTE**
5. Re-launch DM NOTE and follow the instructions in [2. Permission Setup](#2-permission-setup) to add permissions again
6. Restart the app

> **Note:** This issue occurs because the app is not signed with an Apple Developer ID. macOS treats each new version as a different app, resetting the permissions.

---

## Troubleshooting

### App Won't Open

```bash
sudo xattr -cr /Applications/DM\ NOTE.app
```

### Key Input Not Being Captured

1. Verify both permissions (Accessibility + Input Monitoring) are enabled
2. Completely quit and restart the app
3. If after installing a new version, refer to "3. Installing New Versions" above
