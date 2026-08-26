#!/usr/bin/env bash
# src-tauri/icons/DM NOTE.icon 마스터에서 플랫폼별 아이콘을 다시 만든다
# 맥: Assets.car(Liquid Glass) + icon.icns(구형 macOS 폴백)
# 윈도우: 기본 스타일 시스템 렌더를 잘라 icon.ico
# macOS 26 + Xcode 26 필요
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="$ROOT/src-tauri/icons"
NAME="DM NOTE"
DEV="${DEVELOPER_DIR:-$(xcode-select -p)}"
ACTOOL="$DEV/usr/bin/actool"

if [ ! -x "$ACTOOL" ]; then
  echo "actool을 찾을 수 없습니다. Xcode 26을 설치하고 xcode-select로 지정하세요" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "1/3 .icon 컴파일"
mkdir -p "$TMP/out"
if ! "$ACTOOL" "$ICONS/$NAME.icon" \
  --compile "$TMP/out" \
  --platform macosx \
  --minimum-deployment-target 26.0 \
  --app-icon "$NAME" \
  --standalone-icon-behavior all \
  --output-partial-info-plist "$TMP/partial.plist" \
  --output-format human-readable-text --errors --warnings \
  > "$TMP/actool.log" 2>&1; then
  cat "$TMP/actool.log" >&2
  exit 1
fi
if grep -q "error:" "$TMP/actool.log"; then
  cat "$TMP/actool.log" >&2
  exit 1
fi
cp "$TMP/out/Assets.car" "$ICONS/Assets.car"
cp "$TMP/out/$NAME.icns" "$ICONS/icon.icns"

echo "2/3 시스템 렌더 추출"
# 실행 파일이 없으면 실행 불가 배지가 아이콘에 겹치므로 더미 바이너리를 넣는다
STUB="$TMP/IconStub.app/Contents"
mkdir -p "$STUB/Resources" "$STUB/MacOS"
cp "$TMP/out/Assets.car" "$STUB/Resources/"
cp /usr/bin/true "$STUB/MacOS/$NAME"
cat > "$STUB/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.dmnote.iconstub</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleIconName</key><string>$NAME</string>
</dict></plist>
PLIST
swiftc -O "$ROOT/scripts/icon/render_icon.swift" -o "$TMP/render_icon"
"$TMP/render_icon" "$TMP/IconStub.app" "$TMP/icon-windows.png" 1024 --crop -AppleIconAppearanceTheme RegularAutomatic

echo "3/3 윈도우 ico 생성"
(cd "$ROOT" && npx tauri icon "$TMP/icon-windows.png" -o "$TMP/ico" >/dev/null)
cp "$TMP/ico/icon.ico" "$ICONS/icon.ico"

echo "완료: Assets.car, icon.icns, icon.ico"
