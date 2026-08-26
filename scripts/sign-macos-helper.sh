#!/usr/bin/env bash
# macOS Dock 헬퍼 앱 사전 서명 (Tauri beforeBundleCommand)
#
# 헬퍼는 메인 앱의 Contents/Resources 안에 nested .app으로 들어가는데,
# Tauri의 앱 번들 서명은 Resources 안 nested code까지 서명하지 않아
# 공증(notarization)이 "The binary is not signed"로 거절된다.
# → 번들링 전에 헬퍼를 직접 서명하고, 이후 메인 앱 서명이 이를 리소스로 봉인한다.
#
# APPLE_SIGNING_IDENTITY 미설정 시 no-op (개발 빌드).
# identity는 환경변수로만 관리 — bundle.macOS.signingIdentity(config)로 옮기면
# 이 훅이 no-op이 되어 헬퍼가 미서명 상태로 번들된다.
# CI에서는 인증서가 키체인 검색 목록에 미리 import되어 있어야 한다
# (Tauri의 APPLE_CERTIFICATE 임시 키체인은 번들 단계에서 생성되므로 이 훅 시점엔 없음).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HELPER_BUNDLE="${1:-${REPO_ROOT}/src-tauri/target/dmnote-helper/DM NOTE.app}"
IDENTITY="$(printf '%s' "${APPLE_SIGNING_IDENTITY:-}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"

fail() {
  echo "[FAIL] $*" >&2
  exit 1
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

if [[ -z "$IDENTITY" ]]; then
  echo "[skip] APPLE_SIGNING_IDENTITY 미설정 — 헬퍼 서명 생략"
  exit 0
fi

[[ -d "$HELPER_BUNDLE" ]] || fail "헬퍼 번들을 찾을 수 없음: $HELPER_BUNDLE"

# 프리플라이트: identity가 키체인 검색 목록에 있는지 (ad-hoc "-" 제외)
if [[ "$IDENTITY" != "-" ]] \
  && ! security find-identity -v -p codesigning | grep -qF "$IDENTITY"; then
  echo "[FAIL] 키체인에서 identity를 찾을 수 없음: $IDENTITY" >&2
  echo "       CI에서는 번들 단계 이전에 인증서를 키체인 검색 목록에 import해야 함" >&2
  echo "       (Tauri의 APPLE_CERTIFICATE 임시 키체인은 이 훅 이후에 생성됨)" >&2
  exit 1
fi

# --timestamp는 ad-hoc에서 무시되므로 분기 불필요
echo "[sign] 헬퍼 서명: $HELPER_BUNDLE"
codesign --force --options runtime --timestamp --sign "$IDENTITY" "$HELPER_BUNDLE"
codesign --verify --strict --verbose=2 "$HELPER_BUNDLE"
codesign -dvv "$HELPER_BUNDLE" 2>&1 \
  | grep -E "^(Identifier=|Authority=|TeamIdentifier=|Timestamp=|CodeDirectory )" \
  | sed 's/^/       /' || true
echo "[OK] 헬퍼 서명 완료"
