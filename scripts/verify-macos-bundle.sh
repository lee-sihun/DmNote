#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_BUNDLE="${1:-${REPO_ROOT}/src-tauri/target/release/bundle/macos/DM NOTE.app}"

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "파일을 찾을 수 없음: $1"
}

read_executable_name() {
  /usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$1" 2>/dev/null \
    || fail "CFBundleExecutable을 읽을 수 없음: $1"
}

read_minos() {
  local binary="$1"
  local arch="$2"
  local build_info
  local minos
  build_info="$(xcrun vtool -show-build -arch "$arch" "$binary" 2>/dev/null || true)"
  minos="$(awk '
    $1 == "minos" { print $2; found = 1; exit }
    $1 == "cmd" { legacy = ($2 == "LC_VERSION_MIN_MACOSX"); next }
    legacy && $1 == "version" { legacy_version = $2; legacy = 0 }
    END {
      if (!found && legacy_version != "") print legacy_version
    }
  ' <<<"$build_info")"
  [[ -n "$minos" ]] \
    || fail "최소 macOS 버전을 판별할 수 없음: $binary ($arch)"
  echo "$minos"
}

read_plist_min_version() {
  /usr/libexec/PlistBuddy -c "Print :LSMinimumSystemVersion" "$1" 2>/dev/null || true
}

MIN_SYSTEM_VERSION="11.0"

command -v lipo >/dev/null 2>&1 || fail "lipo를 찾을 수 없음"
command -v xcrun >/dev/null 2>&1 || fail "xcrun을 찾을 수 없음"
[[ -x /usr/libexec/PlistBuddy ]] || fail "PlistBuddy를 찾을 수 없음"
[[ -d "$APP_BUNDLE" ]] || fail "앱 번들을 찾을 수 없음: $APP_BUNDLE"

MAIN_INFO="${APP_BUNDLE}/Contents/Info.plist"
HELPER_BUNDLE="${APP_BUNDLE}/Contents/Resources/DM NOTE.app"
HELPER_INFO="${HELPER_BUNDLE}/Contents/Info.plist"
NOTICES="${APP_BUNDLE}/Contents/Resources/THIRD_PARTY_NOTICES.txt"

require_file "$MAIN_INFO"
[[ -d "$HELPER_BUNDLE" ]] || fail "helper 번들을 찾을 수 없음: $HELPER_BUNDLE"
require_file "$HELPER_INFO"
require_file "$NOTICES"

MAIN_EXECUTABLE="${APP_BUNDLE}/Contents/MacOS/$(read_executable_name "$MAIN_INFO")"
HELPER_EXECUTABLE="${HELPER_BUNDLE}/Contents/MacOS/$(read_executable_name "$HELPER_INFO")"
require_file "$MAIN_EXECUTABLE"
require_file "$HELPER_EXECUTABLE"
[[ -x "$MAIN_EXECUTABLE" ]] || fail "main 바이너리에 실행 권한이 없음: $MAIN_EXECUTABLE"
[[ -x "$HELPER_EXECUTABLE" ]] || fail "helper 바이너리에 실행 권한이 없음: $HELPER_EXECUTABLE"

# plist 최소 버전이 바이너리 minos와 일치하는지 비교 (표기-실행 불일치 방지)
MAIN_PLIST_MIN="$(read_plist_min_version "$MAIN_INFO")"
[[ "$MAIN_PLIST_MIN" == "$MIN_SYSTEM_VERSION" ]] \
  || fail "main LSMinimumSystemVersion이 ${MIN_SYSTEM_VERSION}이 아님: ${MAIN_PLIST_MIN:-없음}"
echo "[OK] main plist LSMinimumSystemVersion=$MAIN_PLIST_MIN"

HELPER_PLIST_MIN="$(read_plist_min_version "$HELPER_INFO")"
[[ "$HELPER_PLIST_MIN" == "$MIN_SYSTEM_VERSION" ]] \
  || fail "helper LSMinimumSystemVersion이 ${MIN_SYSTEM_VERSION}이 아님: ${HELPER_PLIST_MIN:-없음}"
echo "[OK] helper plist LSMinimumSystemVersion=$HELPER_PLIST_MIN"

HELPER_ARCHS="$(lipo -archs "$HELPER_EXECUTABLE")"
for arch in arm64 x86_64; do
  case " $HELPER_ARCHS " in
    *" $arch "*) ;;
    *) fail "helper에 $arch 아키텍처가 없음: $HELPER_ARCHS" ;;
  esac

  minos="$(read_minos "$HELPER_EXECUTABLE" "$arch")"
  [[ "$minos" == "$MIN_SYSTEM_VERSION" ]] \
    || fail "helper $arch minos가 ${MIN_SYSTEM_VERSION}이 아님: ${minos:-없음}"
  echo "[OK] helper $arch minos=$minos"
done

MAIN_ARCHS="$(lipo -archs "$MAIN_EXECUTABLE")"
[[ -n "$MAIN_ARCHS" ]] || fail "main 바이너리 아키텍처를 읽을 수 없음"
for arch in $MAIN_ARCHS; do
  minos="$(read_minos "$MAIN_EXECUTABLE" "$arch")"
  [[ "$minos" == "$MIN_SYSTEM_VERSION" ]] \
    || fail "main $arch minos가 ${MIN_SYSTEM_VERSION}이 아님: ${minos:-없음}"
  echo "[OK] main $arch minos=$minos"
done

echo "[OK] helper 경로: $HELPER_BUNDLE"
echo "[OK] notices 경로: $NOTICES"
echo "[OK] macOS 번들 검증 완료"
