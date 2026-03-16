# Window Band Overlay PoC 실험 결과

> 2026-03-16 | DmNote Real Overlay 연구

## 배경

2일간의 Game Bar 리버싱(`docs/gamebar-real-overlay-findings-2026-03-14.md`)에서 핵심 사실이 드러남:

1. Game Bar의 최종 렌더링은 일반 Win32 API (`SetWindowRgn`, `WS_EX_TRANSPARENT`)
2. Z-order 특권은 `ApplicationFrameWindow` (UWP shell mechanism)에서 옴
3. Game Bar 내부 경로 재사용은 다층 gate(PackageIdentity + AllowList + Shell companion)에 막혀 비현실적

**전략 전환**: Game Bar 파이프라인이 아니라, 같은 Z-order 특권을 얻는 대안 Windows 메커니즘을 실험.

---

## 실험 1: SetWindowBand — 기존 창 band 승격

### 목표
기존 Win32 TOPMOST 창의 band를 `SetWindowBand()`로 런타임에 올려서 fullscreen 위에 표시.

### 방법
- `scripts/gamebar/poc-setwindowband.ps1`
- borderless fullscreen probe(band=1) + small overlay(band=1) 생성
- `user32.dll!SetWindowBand(hWnd, NULL, band)` — band 2~18 순차 시도
- 관리자 권한으로 실행

### 결과

| band | SetWindowBand | error | actual band |
|------|--------------|-------|-------------|
| 2~14 | FAIL | 0x00000005 (ACCESS_DENIED) | 1 |
| 15 | FAIL | 0x00000005 (ACCESS_DENIED) | 1 |
| 16~18 | FAIL | 0x00000005 (ACCESS_DENIED) | 1 |

산출물: [`docs/artifacts/poc-setwindowband-results.json`](docs/artifacts/poc-setwindowband-results.json)

**결론**: SetWindowBand는 관리자 권한으로도 band 승격 불가. SYSTEM/SeTcbPrivilege 수준의 권한 필요.

---

## 실험 2: CreateWindowInBand — 높은 band에 새 창 생성

### 목표
`CreateWindowInBand()` / `CreateWindowInBandEx()`로 처음부터 높은 band에서 창 생성.

### 방법
- `scripts/gamebar/poc-createwindowinband.ps1`
- 커스텀 윈도우 클래스 등록 후 band 0~18 순차 생성
- 관리자 권한으로 실행

### 결과

| band | CreateWindowInBand | CreateWindowInBandEx | actual band |
|------|--------------------|---------------------|-------------|
| 0 | OK | OK | 1 (clamped) |
| 1 | OK | OK | 1 |
| 2~14 | FAIL (0x00000005) | FAIL (0x00000005) | - |
| 15 | FAIL (0x00000057 INVALID_PARAMETER) | FAIL (0x00000057) | - |
| 16~18 | FAIL (0x00000005) | FAIL (0x00000005) | - |

산출물: [`docs/artifacts/poc-createwindowinband-results.json`](docs/artifacts/poc-createwindowinband-results.json)

**결론**: Band 0~1만 생성 가능, band 2+는 SetWindowBand와 동일하게 ACCESS_DENIED. Band API 경로 확정 폐쇄.

---

## 실험 3: UIAccess — 공식 접근성 메커니즘 ★ 성공

### 목표
`uiAccess="true"` manifest를 가진 서명된 EXE가 band 승격을 받는지 확인.

### 방법
- `scripts/gamebar/poc-uiaccess.ps1`
- 자체 서명 코드 서명 인증서 생성 + Trusted Root 설치
- C# EXE 컴파일: `uiAccess="true"` manifest 포함
- 인증서로 서명
- `C:\Program Files\DmNotePoC\`에서 ShellExecute로 실행 (UIAccess 토큰 부여)
- 대조군: 같은 EXE를 `%TEMP%`에서 실행 (비보안 경로 → UIAccess 미부여)

### UIAccess 조건 3가지
1. **Manifest**: `<requestedExecutionLevel level="asInvoker" uiAccess="true" />`
2. **Code Signing**: 유효한 Authenticode 서명 (자체 서명 + Trusted Root 설치 가능)
3. **Secure Path**: `C:\Program Files\`, `C:\Windows\` 등 보호된 경로에서 실행

### 결과

| 조건 | probe band | overlay band | overlayVisible | foregroundIsProbe |
|------|-----------|-------------|----------------|-------------------|
| **UIAccess (Program Files)** | **2** | **2** | true | true |
| Control (TEMP) | 1 | 1 | true | true |

산출물: [`docs/artifacts/poc-uiaccess-results.json`](docs/artifacts/poc-uiaccess-results.json)

### 핵심 발견

1. **UIAccess 프로세스의 모든 창이 자동으로 band=2 (`ZBID_ABOVELOCK_UX`)로 승격됨**
2. 대조군(같은 EXE, 같은 서명)은 비보안 경로에서 실행 시 band=1 유지
3. SetWindowBand/CreateWindowInBand로는 ACCESS_DENIED였던 band=2를 UIAccess가 자동 획득
4. 별도의 Band API 호출 없이 프로세스 토큰에 UIAccess flag만으로 충분

---

## 종합 결론

| 접근법 | band 승격 | 관리자 필요 | 실용성 |
|--------|----------|-----------|--------|
| SetWindowBand | 실패 (ACCESS_DENIED) | N/A | 불가 |
| CreateWindowInBand | 실패 (ACCESS_DENIED) | N/A | 불가 |
| **UIAccess manifest** | **band=2 성공** | 초기 설치만 | **실용적** |

### UIAccess 경로의 장단점

**장점**:
- Windows 공식 접근성 메커니즘 (문서화됨, 안정적)
- band=2 자동 획득 — fullscreen 앱 위에 표시 가능
- 코드 서명은 자체 서명으로도 가능 (설치 시 한 번만 신뢰 설정)
- 접근성 도구, 화면 키보드, 입력 도우미 등이 이미 사용하는 검증된 경로

**조건/제약**:
- 설치 경로가 `Program Files` 등 보호된 위치여야 함
- Authenticode 서명 필수 (자체 서명 + Trusted Root 설치 또는 상용 인증서)
- 설치 시 한 번 관리자 권한 필요 (인증서 설치 + Program Files 쓰기)

---

## 실제 게임 검증 (2026-03-16)

### UIAccess 게임 테스트
`scripts/gamebar/poc-uiaccess-gametest.ps1`로 60초간 band=2 오버레이를 표시하고 실제 게임에서 테스트.

| 게임 모드 | 오버레이 표시 | 비고 |
|-----------|-------------|------|
| **Borderless Fullscreen** | **OK** | band=2 오버레이가 게임 위에 표시됨 |
| **Exclusive Fullscreen** | **OK** | band=2가 exclusive fullscreen도 관통 |

### 대조군: plain TOPMOST (band=1) 게임 테스트
`scripts/gamebar/poc-topmost-control-gametest.ps1`로 UIAccess 없이 순수 TOPMOST(band=1) 오버레이를 동일 조건에서 테스트.

| 게임 모드 | 오버레이 표시 | 비고 |
|-----------|-------------|------|
| **Exclusive Fullscreen** | **안 보임** | band=1 TOPMOST는 fullscreen에 가려짐 |

### 결론

- **band=2 (UIAccess)만이 fullscreen 위 표시 가능**, plain TOPMOST(band=1)는 불가
- 실험 1, 2에서 시각적으로 보였던 것은 PoC 자체 probe(동일 band=1) 위에 잠깐 보인 것이며, 실제 게임 fullscreen에서는 안 됨
- UIAccess의 band=2 승격이 핵심 메커니즘임을 대조군 실험으로 확정

---

## 다음 단계

1. ~~**실제 게임에서 검증**~~ — 완료 (borderless + exclusive 모두 성공)
2. ~~**대조군 검증**~~ — 완료 (band=1 TOPMOST는 fullscreen 위 불가 확인)
3. **Tauri 통합 설계**: DmNote 오버레이 윈도우에 UIAccess 적용 방안 설계
   - 옵션 A: Tauri 앱 자체에 `uiAccess="true"` manifest + 서명
   - 옵션 B: 별도 UIAccess 헬퍼 프로세스가 오버레이 윈도우 소유
4. **설치 프로세스**: 인증서 설치 + Program Files 배치를 인스톨러에 포함
