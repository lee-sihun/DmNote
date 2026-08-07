# PR #114 병합 준비 계획

> 작성일: 2026-08-07
> 최종 업데이트: 2026-08-07 — 물리 입력 refcount 및 공개 API 계약 검토 반영
> 대상 PR: [#114 feat: 여러 키 매핑 지원](https://github.com/DmNote-App/DmNote/pull/114)
> 검토 기준: PR head `4c3c824`, `master` `68c6987`
> 상태: **구현·자동 검증 완료 — Windows 11 실기 검증 대기**

---

## 1. 목적

PR #114의 여러 키 매핑 기능을 최신 `master`에 안전하게 통합한다. 다음 조건을 모두 만족해야 병합 가능 상태로 전환한다.

1. 단일·다중 키 슬롯의 노트 홀드 시간이 물리 장치 수와 키 해제 순서에 무관하게 canonical 슬롯의 실제 활성 시간을 반영한다.
2. 최신 `master`와의 충돌을 해소하면서 오버레이 레이아웃의 참조 안정성 최적화를 보존한다.
3. Rust·TypeScript 자동 검증과 Windows 11 실기 검증을 모두 통과한다.
4. OBS 프로토콜, 플러그인 capability, 기존 store·프리셋 호환성을 회귀시키지 않는다.

## 2. 현재 상태

### 확인된 병합 차단 사항

| 항목                | 현재 상태                                                 | 영향                                                                  |
| ------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| canonical 홀드 시간 | canonical `UP`에 마지막 물리 키의 `hold_duration_ms` 전달 | 다중 슬롯 또는 같은 라벨의 복수 장치 입력에서 지연 노트 길이가 달라짐 |
| 최신 `master` 통합  | GitHub `CONFLICTING / DIRTY`                              | 현재 상태로 병합 불가                                                 |
| 오버레이 충돌       | `src/renderer/windows/overlay/App.tsx` 충돌               | 잘못 해결하면 레이아웃 memoization 무효화                             |
| Windows 검증        | 실제 Windows 빌드·입력 검증 결과 없음                     | 변경된 Raw Input 경로의 플랫폼 회귀 가능성 미확인                     |
| GitHub 상태 검사    | 등록된 status check 없음                                  | 저장소 외부에서 병합 게이트가 강제되지 않음                           |

### 검토 중 통과한 항목

- PR head 기준 TypeScript 타입 검사, lint, format check, 프로덕션 빌드 통과
- PR head 기준 프론트엔드 테스트 746개 통과
- PR head 기준 `cargo check`, `cargo clippy --all-targets -- -D warnings` 통과
- PR head 기준 Rust 테스트 438개 통과, 6개 ignored
- 최신 `master` 임시 통합본 기준 프론트엔드 테스트 770개 및 프로덕션 빌드 통과
- 최신 `master` 임시 통합본 기준 Rust 테스트 438개 통과, 6개 ignored

위 결과는 현재 코드의 기본 건전성을 보여주지만, 아래 필수 수정과 Windows 실기 검증을 대체하지 않는다.

`holdDurationMs`는 앱 내부에서 **지연 노트가 활성화된 경로의 길이 정책에만** 사용된다. 비지연 노트는 `displayTime` 기준으로 즉시 종료하므로 이 오류의 시각적 영향은 지연 노트에서 발생한다. 다만 동일 필드가 `dmn.keys.onKeyState`와 플러그인 `onHook('key')`에도 공개되므로, 외부 플러그인에 대해서는 지연 노트 설정과 무관한 API 계약 문제다.

## 3. 구현 결정

### 3.1 canonical 슬롯 홀드 시간 정책

노트 홀드 시간은 **canonical 슬롯이 비활성에서 활성으로 전환된 시각부터 다시 비활성으로 전환된 시각까지**로 정의한다.

- authoritative 물리 홀드의 사용 여부는 슬롯이 단일인지 다중인지로 판정하지 않는다.
- canonical `DOWN`을 만든 물리 입력과 canonical `UP`을 만든 물리 입력이 동일할 때만 해당 물리 입력의 데몬 `hold_duration_ms`를 신뢰한다.
- 두 transition의 물리 source가 다르거나 activation source를 알 수 없으면 `UP` payload의 `holdDurationMs`를 생략하고, 프론트가 canonical `DOWN`·`UP`의 보정된 물리 시각 차이를 사용한다.
- `KeyboardState`는 active canonical별 activation source physical ID를 명시적으로 추적한다. `SlotEvent`는 app state가 문자열을 재해석하지 않도록 물리 hold 사용 가능 여부를 전달한다.
- 모드·매핑 재구성처럼 canonical active 상태는 복구되지만 activation source를 확정할 수 없는 경로에서는 보수적으로 source unknown으로 처리하고 물리 hold를 전달하지 않는다.

이 방식은 같은 라벨을 내는 키보드 두 대의 겹친 입력과 다중 슬롯을 같은 규칙으로 처리하며, 백엔드에 별도 시계를 중복 관리하지 않고 기존 프론트엔드 fallback을 재사용한다. 향후 canonical 홀드 시간을 백엔드에서 직접 제공해야 한다면 별도 필드와 명확한 wire contract로 확장한다.

fallback은 비클램프 `physDownTime`·`physReleaseTime` 차이를 사용하되, 입력 시계 이상으로 비정상적으로 부풀지 않도록 상한 방어를 추가한다. 고정된 전체 홀드 상한으로 정상적인 장시간 입력을 자르지 않고, 독립적으로 관측한 display 경과 시간에 명명된 clock-skew 허용치를 더한 값을 상한으로 사용한다. 경계값과 장시간 홀드를 테스트해 정상 입력의 길이는 보존한다.

### 3.2 공개 API timing 계약

`holdDurationMs`는 선택적 필드라는 타입 정의를 유지하되, en/ko 문서의 의미를 실제 payload 정책과 맞춘다.

- canonical `DOWN`과 `UP`의 물리 source가 같을 때만 데몬 측정값이 제공된다.
- source가 다르거나 불명확하면 `UP` 이벤트에서도 필드가 생략될 수 있다.
- 플러그인이 canonical 홀드를 계산해야 하면 같은 canonical의 `DOWN`·`UP` 시각을 직접 추적해야 한다.
- `dmn.keys.onKeyState`와 `onHook('key')`가 동일한 payload 정책을 사용함을 명시한다.
- “전달 지연과 지터에 항상 영향받지 않는다”는 단정은 조건부 설명으로 교체한다.

### 3.3 오버레이 참조 안정성 정책

충돌 해결 후 다음 값은 `currentSlots`가 실제로 변경될 때만 새 참조를 생성해야 한다.

- `currentKeys`
- `currentKeyLabels`
- `currentValidKeySignature`

`currentSlots: KeySlot[]`의 빈 fallback은 모듈 상수 `EMPTY_SLICE`를 사용하고, 세 파생 값은 `useMemo`에서 함께 계산한다. PR 쪽의 단순 `map()` 구현만 선택해서는 안 된다.

## 4. 작업 단계

### 1단계 — 최신 master 통합

1. `feature/multi-key-binding`에 최신 `origin/master`를 통합한다.
2. 충돌 범위가 예상한 `src/renderer/windows/overlay/App.tsx` 한 곳인지 확인한다.
3. 충돌은 `currentSlots`와 파생 canonical 값 계산 블록에서 해결하고, 자동 병합된 최신 layout 코드는 그대로 보존한다.
   - `keyMappings[selectedKeyType] ?? EMPTY_SLICE`
   - `useMemo([currentSlots])` 기반 canonical 키·표시 라벨·signature 계산
   - 최신 `master`의 plugin layout projection과 `computeLayout` memoization
   - PR의 `slotCanonical`, `slotDisplayName`, `validKeySignature` 사용
4. 충돌 마커와 불필요한 중복 import가 남지 않았는지 확인한다.

완료 기준:

- GitHub가 PR을 `MERGEABLE`로 판정한다.
- unrelated 렌더에서 `currentKeys`와 `currentKeyLabels` 참조가 유지된다.
- 탭 또는 키 매핑 변경 시에는 새 canonical projection이 계산된다.

### 2단계 — canonical 홀드 시간 정정

예상 수정 파일:

| 파일                                                           | 작업                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src-tauri/src/keyboard/manager.rs`                            | active canonical의 activation physical ID 추적 및 `SlotEvent`에 source 일치 여부 추가 |
| `src-tauri/src/state/app_state.rs`                             | source가 같은 canonical `UP`에만 `message.hold_duration_ms` 전달                      |
| `src/renderer/hooks/overlay/useNoteSystem.ts`                  | canonical fallback hold의 clock-skew 상한 방어 추가                                   |
| `src/renderer/hooks/overlay/useNoteSystem.test.tsx`            | authoritative 값 부재·비정상 시각·상한 경계 회귀 테스트 보강                          |
| `src/renderer/hooks/overlay/useNoteSystem.continuity.test.tsx` | 지연 노트 길이 연속성에서 optional hold 계약 검증                                     |
| `src/renderer/windows/overlay/App.test.tsx`                    | optional `holdDurationMs` 전달과 canonical timing 복원 계약 검증                      |
| `docs/content/en/api-reference/keys/page.mdx`                  | `dmn.keys.onKeyState`의 조건부 `holdDurationMs` 의미 반영                             |
| `docs/content/ko/api-reference/keys/page.mdx`                  | 영문과 동일한 keys API 계약 반영                                                      |
| `docs/content/en/declarative-api/page.mdx`                     | `onHook('key')`의 optional hold payload 계약 반영                                     |
| `docs/content/ko/declarative-api/page.mdx`                     | 영문과 동일한 hook 계약 반영                                                          |
| 관련 Rust 테스트 모듈                                          | activation source identity와 payload timing 정책 검증                                 |

필수 테스트 시나리오:

| 슬롯                | 입력 순서                                   | 기대 결과                                                       |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| 단일 `A`·장치 1대   | kb1 A down → kb1 A up                       | source가 같으므로 기존 데몬 홀드 시간 유지                      |
| 단일 `A`·장치 2대   | kb1 down → kb2 down → kb1 up → kb2 up       | kb1 down부터 kb2 up까지 canonical 활성, kb2 물리 홀드 사용 금지 |
| 단일 `A`·장치 2대   | kb1 down → kb2 down → kb2 up → kb1 up       | source가 같으므로 kb1 데몬 홀드가 canonical 구간과 일치         |
| 동시 `A+B`          | A down → B down → A up → B up               | B down부터 A up까지를 canonical 홀드로 판정                     |
| 동시 `A+B`          | B down → A down → B up → A up               | A down부터 B up까지를 canonical 홀드로 판정                     |
| 개별 `A\|B`         | A down → B down → A up → B up               | A down부터 B up까지 슬롯 활성 유지, B 물리 홀드 시간 사용 금지  |
| 개별 `A\|B`         | B down → A down → B up → A up               | B down부터 A up까지 슬롯 활성 유지, A 물리 홀드 시간 사용 금지  |
| 멀티 슬롯 중복 매핑 | 같은 canonical을 참조하는 슬롯 존재         | `DOWN`·`UP` 쌍과 홀드 계산이 중복되거나 분리되지 않음           |
| 반복 down           | 같은 physical ID로 auto-repeat down         | `match_and_register`가 `None`을 반환하고 refcount·timing 불변   |
| unmatched up        | 선행 down 없는 release                      | 잘못된 홀드 시간이 만들어지지 않음                              |
| source unknown      | active 입력 중 모드·매핑 재구성             | 물리 hold를 신뢰하지 않고 canonical fallback 사용               |
| 비정상 event age    | phys 시각 차가 display 경과보다 과도하게 큼 | clock-skew 허용 상한으로 제한                                   |
| 장시간 정상 hold    | 정상 monotonic 시계에서 장시간 유지         | 고정 시간 상한으로 잘리지 않고 실제 canonical 구간 유지         |

완료 기준:

- 물리 장치 수와 멤버 키의 누름·해제 순서를 바꿔도 실제 canonical 활성 구간이 계산된다.
- 단일 물리 입력의 기존 authoritative 홀드는 유지하되, 같은 라벨의 복수 물리 입력에서는 마지막 해제 키의 hold를 잘못 사용하지 않는다.
- 프론트에서 `NaN`, 음수 또는 누락된 timing 값에 대한 기존 방어가 유지된다.
- fallback hold는 비정상 clock skew에 대한 상한을 가지며 정상적인 장시간 hold는 보존한다.

### 3단계 — 자동 검증

프론트엔드:

```bash
npm ci
npx tsc --noEmit
npm run lint
npm run format
npm test -- --reporter=dot
npm run build
```

확인 사항:

- `npm run format` 이후 의도적인 `eslint-disable` 및 `'use no memo'`가 변경되지 않았는지 diff 확인
- 오버레이 테스트에 unrelated store 갱신 시 레이아웃 재계산을 유발하지 않는 참조 안정성 검증 추가
- 키 매핑 변경과 탭 전환 시 예약 타이머 및 눌림 signal 정합성 테스트 유지

백엔드:

```bash
cd src-tauri
cargo check
cargo clippy --all-targets -- -D warnings
cargo fmt --check
cargo test
```

확인 사항:

- ignored 테스트 수가 기준선보다 의도 없이 증가하지 않음
- 커맨드 추가·삭제가 있다면 빌드 후 `permissions/dmnote-allow-all.json` 갱신 여부 확인
- wire payload 변경이 있다면 직렬화 호환 테스트 추가

### 4단계 — Windows 11 실기 검증

PR이 변경한 Windows Raw Input 및 HID 경로는 실제 Windows 11 환경에서 확인한다. macOS의 MSVC cross compile 결과로 대체하지 않는다.

빌드 확인:

- Windows 11에서 `cargo check`, `cargo clippy --all-targets -- -D warnings`
- Windows 11에서 `npm run tauri:build`
- 키보드·마우스·HID feature가 활성화된 실제 프로덕션 바이너리 실행

입력 확인:

1. 키보드 단일 키 down/up 및 auto-repeat
2. 서로 다른 물리 키보드에서 같은 라벨을 `kb1 down → kb2 down → kb1 up → kb2 up` 순서로 입력하고, 지연 노트 ON 상태에서 kb1 down부터 kb2 up까지의 길이가 반영되는지 확인
3. 마우스 버튼이 포함된 개별·동시 매핑
4. `A+B`, `A|B`의 모든 누름·해제 순서
5. 매핑 중 멤버 키가 이미 눌린 상태에서 설정 또는 탭 전환
6. 입력 장치 분리·재연결 후 stuck active 상태가 남지 않는지 확인
7. 키음이 물리 down당 한 번만 재생되고 슬롯 중복 매핑으로 중복되지 않는지 확인
8. 카운터와 오버레이 active 상태가 canonical 식별자로 일치하는지 확인
9. 지연 노트 ON 및 최소 길이 설정에서 단일·개별·동시 슬롯의 실제 canonical 홀드 길이가 표시되는지 확인

각 실패는 입력 순서, 장치 종류, 슬롯 JSON, 기대값과 실제값을 함께 기록한다.

### 5단계 — 호환성 회귀 검증

#### Store·프리셋

- 기존 문자열 슬롯 store를 무손실 로드·저장
- `all`·`any` 다중 슬롯을 저장한 뒤 재시작하여 동일하게 복원
- 손상된 멀티 슬롯을 인덱스 제거 없이 제자리 기본값으로 복구
- 구버전 프리셋 import 후 현재 매핑·position 인덱스 결합 유지
- 다운그레이드 projection에서 멀티 슬롯만 제자리 빈 슬롯으로 대체

#### 플러그인

- `multiKey` capability를 선언한 플러그인의 keys 읽기·쓰기 성공
- capability가 없는 플러그인이 멀티 슬롯을 파괴적으로 덮어쓰려 할 때 `MULTI_KEY_UNSUPPORTED` 반환
- 단일 슬롯만 있는 문서에 대한 기존 플러그인 쓰기 동작 유지
- 오류 코드가 en/ko API 문서와 실제 응답에 동일하게 표기
- `dmn.keys.onKeyState`와 `onHook('key')`에서 source가 같은 `UP`에는 `holdDurationMs`가 있고, source가 다르거나 불명확한 `UP`에는 필드가 생략됨
- optional `holdDurationMs`가 없어도 기존 플러그인 이벤트 전달과 callback 실행이 유지됨

#### OBS

- 프로토콜 v2 앱과 v2 OBS 오버레이 연결 성공
- 구버전 OBS 페이지는 명확한 버전 불일치로 거부
- 브라우저 소스 새로고침 후 정상 복구
- `keys:state`의 canonical 키와 snapshot의 key mapping이 일치
- 개별·동시 슬롯의 active 전환과 노트 timing이 로컬 오버레이와 동일

### 6단계 — 최종 감사 및 병합 승인

1. PR 전체 diff를 최신 `master` 기준으로 다시 검토한다.
2. 자동 포맷이 기능과 무관한 대규모 diff를 만들지 않았는지 확인한다.
3. API·이벤트·오류 코드 변경이 있다면 `docs/content/en/`과 `docs/content/ko/`를 함께 갱신한다.
4. GitHub status check가 없다면 위 명령의 결과와 Windows 실기 결과를 PR 댓글에 남긴다.
5. 아래 수용 기준을 모두 충족한 뒤 승인한다.

## 5. 최종 수용 기준

- [ ] GitHub 기준 충돌 없이 병합 가능
- [ ] 최신 `master`의 오버레이 memoization 및 stable reference 유지
- [ ] 한 물리 입력으로 누른 단일 슬롯의 authoritative 홀드 시간 회귀 없음
- [ ] 같은 라벨의 복수 물리 입력은 첫 canonical `DOWN`부터 마지막 `UP`까지 계산됨
- [ ] `all` 슬롯의 canonical 홀드 시간이 누름·해제 순서와 무관하게 정확함
- [ ] `any` 슬롯의 겹친 입력 구간이 하나의 canonical 활성 구간으로 계산됨
- [ ] fallback hold의 clock-skew 상한 및 정상 장시간 hold 보존 테스트 통과
- [ ] 프론트엔드 타입·lint·format·전체 테스트·프로덕션 빌드 통과
- [ ] Rust check·clippy·format·전체 테스트 통과
- [ ] Windows 11 프로덕션 빌드 및 실제 Raw Input 검증 통과
- [ ] OBS v2 연결·버전 거부·새로고침 복구 검증 통과
- [ ] 플러그인 capability 게이트, 오류 코드 및 optional `holdDurationMs` 계약 검증 통과
- [ ] legacy store·프리셋·다운그레이드 호환성 검증 통과
- [ ] 필요한 en/ko 문서가 함께 갱신됨

## 6. 범위 밖 항목

다음 작업은 PR #114 병합을 위해 새로 확장하지 않는다.

- 다중 키 문법 또는 match mode 추가
- 새로운 노트 timing wire protocol 설계
- 키 카운터 정책 변경
- OBS v2 이후의 추가 프로토콜 기능
- 플러그인 capability 체계 전반의 재설계
- 오버레이 레이아웃 엔진의 추가 성능 개선

범위 밖 문제가 병합 차단 수준으로 발견되면 이 PR에 섞지 않고 별도 이슈로 분리하되, 데이터 손실·입력 오동작·호환성 파괴에 해당하면 병합은 계속 보류한다.

## 7. 권장 작업 단위

리뷰 가능성을 위해 다음 단위로 커밋을 분리한다.

1. `merge: master 충돌 해결` — 최신 layout 안정성 보존
2. `fix: canonical 홀드 source 판정 정정`
3. `test: 물리 입력 중첩과 키 순서 회귀 테스트 보강`
4. `docs: 키 이벤트 홀드 시간 계약 정정`

커밋 제목의 conventional prefix와 기술 용어는 유지하고, 나머지는 프로젝트 규칙에 따라 한글로 작성한다.
