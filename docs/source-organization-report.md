# 소스 폴더 분류 결과와 전수 통계

2026-09-05. 기준 소스: `9a8ad48d`. 적용 브랜치: `refactor/runtime-safety-and-structure`. 실행 계획은 [후속 계획](source-organization-plan.md)을 따른다.

일반·strict 타입 검사, 전체 Vitest 3,604개, CI 정책 테스트 15개, lint·format·build를 통과했다. 성능 시나리오 18개는 별도로 활성화해 실행했다. 실제 macOS WebView 단일·batch 패널은 통과했으며, 전체 상호작용 matrix의 간헐적 GRID-05 대기 실패는 이전 소스에서도 재현되어 [검증 한계](source-organization-plan.md#벤치마크-실행과-한계)에 기록했다.

## 집계 방법과 범위

`rg --files --hidden src src-tauri/src`로 이동 전후 목록을 확보했다. 각 파일의 모든 상위 디렉터리를 포함하며 Git ignore 대상·빈 디렉터리·저장소 루트의 tests/scripts/docs·빌드 산출물은 제외한다. 코드 확장자는 `.ts`, `.tsx`, `.rs`, `.css`, `.html`이다. 테스트 파일은 `.test.`·`.spec.`·`tests.rs`·`tests/` 경로로 판정한다. Rust 내부 테스트 수나 커버리지를 뜻하지 않는다. 하위 포함 합계는 행 사이에 중복되므로 전체 합산하지 않는다.

309개 파일의 이전→이후 경로를 적용한 예상 목록과 실제 목록을 대조했다. 전체 1,224개 파일에서 누락·추가 0개이며, 이동 때문에 생성한 호환 파일도 없다. strict 검사 대상의 프로젝트 소스는 이동 전후 69개로 동일하다.

## 규모 변화

| 항목                            | 이전 | 이후 |
| ------------------------------- | ---: | ---: |
| 파일이 있는 경로와 그 상위 폴더 |  143 |  186 |
| 전체 파일                       | 1224 | 1224 |
| 코드 파일                       | 1190 | 1190 |
| 직속 파일 최대                  |   41 |   23 |
| 소스 루트 기준 최대 폴더 깊이   |    6 |    7 |

최대 깊이는 `src` 및 `src-tauri/src`를 0으로 계산했다. 파일 수·깊이는 설명용 통계이며 구조 품질의 합격 기준이 아니다.

| 주요 대상 (`src/renderer/` 기준)             | 이전 직속 | 이후 직속 |
| -------------------------------------------- | --------: | --------: |
| `utils/core`                                 |        39 |         3 |
| `components/main/common`                     |        33 |        14 |
| `components/main/Modal`                      |        34 |        11 |
| `components/main/Modal/content/pickers`      |        37 |         9 |
| `hooks/Grid`                                 |        41 |         9 |
| `components/main/Grid/PropertiesPanel/batch` |        33 |        16 |
| `api/modules`                                |        37 |         2 |
| `__tests__`                                  |        41 |         2 |
| `benchmarks`                                 |        37 |         4 |
| `utils/plugin`                               |        28 |         6 |
| `components/shared`                          |        26 |         3 |

## 유지 판단

- `PropertiesPanel/layer` 23개(테스트 11개): 레이어 편집 한 영역의 조립·선택·DnD·rename이 이름으로 구별된다. 책임을 소유하는 기존 경계를 유지했다.
- `utils/grid` 23개: 순수 좌표·선택 보조 기능과 테스트를 모으며, 다파일 smartGuides는 이미 하위 모듈로 구분되어 있다.
- `hooks` 22개와 `PropertiesPanel/single` 21개: 공통 동작 훅과 단일 선택 조립/패널의 기존 진입점을 유지했다. 낙관적 commit 전용 하위 폴더나 single 패널별 분류는 향후 해당 기능 확장 때 재검토할 수 있다. 이번에는 독립 파일마다 폴더를 추가하지 않았다.
- `utils/core`의 `platform`과 `stableStringify`는 여러 화면·편집 runtime이 사용하는 작은 공통 기능이다. `mixedValue`는 batch 전용으로, `stableHandlerSlots`는 공유 UI 보조 기능으로 옮겼다.
- 백엔드 `models`, `state`, `app_state`, `store`는 모듈 선언·주요 타입/메서드·가시성을 확인했다. 동일 AppState/store의 impl 분담과 `pub(super)` 경계를 유지하기 위해 이동하지 않았다. Rust 소스·command/event·permissions·저장 형식 변경은 없다.
- 나머지 폴더는 아래 표의 책임 기준으로 유지했다. 이 검토는 폴더 배치와 연결 경계에 관한 것이며 모든 함수의 내부 품질을 다시 감사한 것은 아니다.

## 전체 폴더 통계와 판정

이전 직속은 같은 경로의 이전 파일 수다. 새 폴더는 0이다. `분류`는 해당 폴더에서 이동이 발생했음을, `신설`은 새 기능 묶음을 뜻한다.

| 폴더                                                               | 이전 직속 | 현재 직속 | 코드 | 테스트 | 하위 포함 | 판정·근거                                                                                  |
| ------------------------------------------------------------------ | --------: | --------: | ---: | -----: | --------: | ------------------------------------------------------------------------------------------ |
| `src`                                                              |         0 |         0 |    0 |      0 |      1039 | 유지: 프론트·공유 타입의 최상위 경계                                                       |
| `src-tauri/src`                                                    |         8 |         8 |    8 |      0 |       185 | 유지: 네이티브 앱 진입점과 기존 도메인 모듈 유지                                           |
| `src-tauri/src/audio`                                              |         2 |         2 |    2 |      0 |         6 | 유지: 기존 역할 유지                                                                       |
| `src-tauri/src/audio/engine`                                       |         4 |         4 |    4 |      1 |         4 | 유지: 오디오 엔진·플랫폼 구현·테스트의 기존 경계 유지                                      |
| `src-tauri/src/commands`                                           |         2 |         2 |    2 |      0 |        53 | 유지: 기존 역할 유지                                                                       |
| `src-tauri/src/commands/app`                                       |         6 |         6 |    6 |      0 |         8 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/app/update_macos`                          |         2 |         2 |    2 |      0 |         2 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/editor`                                    |         8 |         8 |    8 |      0 |        10 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/editor/css`                                |         2 |         2 |    2 |      1 |         2 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/keys`                                      |         4 |         4 |    4 |      0 |         9 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/keys/keys`                                 |         2 |         2 |    2 |      1 |         2 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/keys/sound`                                |         3 |         3 |    3 |      1 |         3 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/layout`                                    |         9 |         9 |    9 |      0 |         9 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/media`                                     |         3 |         3 |    3 |      0 |         3 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/plugin`                                    |         5 |         5 |    5 |      0 |         5 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/preset`                                    |         4 |         4 |    4 |      1 |         7 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/commands/preset/load`                               |         3 |         3 |    3 |      1 |         3 | 유지: Tauri command 도메인과 관련 구현·테스트 경계 유지                                    |
| `src-tauri/src/keyboard`                                           |         3 |         3 |    3 |      0 |         8 | 유지: 기존 역할 유지                                                                       |
| `src-tauri/src/keyboard/daemon`                                    |         4 |         4 |    4 |      0 |         4 | 유지: 키 입력 관리·플랫폼 구현의 기존 경계 유지                                            |
| `src-tauri/src/keyboard/manager`                                   |         1 |         1 |    1 |      1 |         1 | 유지: 키 입력 관리·플랫폼 구현의 기존 경계 유지                                            |
| `src-tauri/src/models`                                             |        14 |        14 |   14 |      1 |        15 | 유지: 직렬화 모델의 재수출과 pub(super) 기본값 함수 경계 유지                              |
| `src-tauri/src/models/editor`                                      |         1 |         1 |    1 |      1 |         1 | 유지: 해당 데이터 모델과 전용 테스트의 기존 경계 유지                                      |
| `src-tauri/src/services`                                           |         9 |         9 |    9 |      0 |        22 | 유지: 기존 역할 유지                                                                       |
| `src-tauri/src/services/obs_bridge`                                |         5 |         5 |    5 |      1 |         8 | 유지: 서비스·프로토콜·플랫폼별 기존 구현 경계 유지                                         |
| `src-tauri/src/services/obs_bridge/media`                          |         1 |         1 |    1 |      1 |         1 | 유지: 서비스·프로토콜·플랫폼별 기존 구현 경계 유지                                         |
| `src-tauri/src/services/obs_bridge/rpc`                            |         1 |         1 |    1 |      1 |         1 | 유지: 서비스·프로토콜·플랫폼별 기존 구현 경계 유지                                         |
| `src-tauri/src/services/obs_bridge/websocket`                      |         1 |         1 |    1 |      1 |         1 | 유지: 서비스·프로토콜·플랫폼별 기존 구현 경계 유지                                         |
| `src-tauri/src/services/overlay_hit`                               |         1 |         1 |    1 |      1 |         4 | 유지: 서비스·프로토콜·플랫폼별 기존 구현 경계 유지                                         |
| `src-tauri/src/services/overlay_hit/platform`                      |         3 |         3 |    3 |      0 |         3 | 유지: 서비스·프로토콜·플랫폼별 기존 구현 경계 유지                                         |
| `src-tauri/src/services/preview_broker`                            |         1 |         1 |    1 |      1 |         1 | 유지: 서비스·프로토콜·플랫폼별 기존 구현 경계 유지                                         |
| `src-tauri/src/state`                                              |        13 |        13 |   13 |      0 |        73 | 유지: AppState·store·editor·history·migration의 소유 경계 유지                             |
| `src-tauri/src/state/app_state`                                    |        12 |        12 |   12 |      1 |        14 | 유지: AppState impl의 창·입력·생명주기 분담과 pub(super) 접근 유지                         |
| `src-tauri/src/state/app_state/window_geometry`                    |         2 |         2 |    2 |      0 |         2 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/assets`                                       |         4 |         4 |    4 |      0 |         4 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/editor`                                       |         4 |         4 |    4 |      1 |         4 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/editor_ops`                                   |         4 |         4 |    4 |      1 |         5 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/editor_ops/transition`                        |         1 |         1 |    1 |      0 |         1 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/gesture`                                      |         1 |         1 |    1 |      1 |         1 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/history`                                      |         3 |         3 |    3 |      1 |         3 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/migration`                                    |         4 |         4 |    4 |      1 |         4 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/native_element_id`                            |         2 |         2 |    2 |      1 |         2 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/plugin`                                       |         1 |         1 |    1 |      1 |         1 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/store`                                        |        11 |        11 |   11 |      1 |        13 | 유지: 동일 store 트랜잭션·writer·복구 경계 유지                                            |
| `src-tauri/src/state/store/sound_assets`                           |         2 |         2 |    2 |      0 |         2 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/window`                                       |         6 |         6 |    6 |      0 |         9 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src-tauri/src/state/window/panel_drag`                            |         3 |         3 |    3 |      1 |         3 | 유지: 상태·저장·복구의 기존 모듈 가시성과 소유 경계 유지                                   |
| `src/renderer`                                                     |         2 |         2 |    2 |      1 |      1006 | 유지: 렌더러 기본값과 기능별 하위 영역                                                     |
| `src/renderer/__tests__`                                           |        41 |         2 |    2 |      0 |        41 | 분류: setup과 여러 UI가 사용하는 deferredContentHarness 유지                               |
| `src/renderer/__tests__/editor`                                    |         0 |         7 |    7 |      7 |         7 | 신설: 여러 UI를 가로지르는 해당 기능의 계약 테스트                                         |
| `src/renderer/__tests__/panel`                                     |         0 |         5 |    5 |      5 |         5 | 신설: 여러 UI를 가로지르는 해당 기능의 계약 테스트                                         |
| `src/renderer/__tests__/plugin`                                    |         0 |         2 |    2 |      2 |         2 | 신설: 여러 UI를 가로지르는 해당 기능의 계약 테스트                                         |
| `src/renderer/__tests__/popup`                                     |         0 |         7 |    7 |      7 |         7 | 신설: 여러 UI를 가로지르는 해당 기능의 계약 테스트                                         |
| `src/renderer/__tests__/rendering`                                 |         0 |        18 |   18 |     18 |        18 | 신설: 여러 UI를 가로지르는 해당 기능의 계약 테스트                                         |
| `src/renderer/api`                                                 |         7 |         7 |    7 |      2 |        44 | 유지: dmnoteApi·internalApi·hostGlobalApi와 IPC shim 진입점 유지                           |
| `src/renderer/api/modules`                                         |        37 |         2 |    2 |      1 |        37 | 분류: 공유 transport만 잔류; API 도메인별 분류                                             |
| `src/renderer/api/modules/app`                                     |         0 |         5 |    5 |      1 |         5 | 신설: 해당 도메인의 API와 전용 테스트; 공용 transport 참조                                 |
| `src/renderer/api/modules/editor`                                  |         0 |        13 |   13 |      5 |        13 | 신설: 해당 도메인의 API와 전용 테스트; 공용 transport 참조                                 |
| `src/renderer/api/modules/plugin`                                  |         0 |         7 |    7 |      2 |         7 | 신설: 해당 도메인의 API와 전용 테스트; 공용 transport 참조                                 |
| `src/renderer/api/modules/resources`                               |         0 |         4 |    4 |      0 |         4 | 신설: 해당 도메인의 API와 전용 테스트; 공용 transport 참조                                 |
| `src/renderer/api/modules/window`                                  |         0 |         6 |    6 |      2 |         6 | 신설: 해당 도메인의 API와 전용 테스트; 공용 transport 참조                                 |
| `src/renderer/assets`                                              |         0 |         0 |    0 |      0 |        29 | 유지: 하위 영역을 모으는 분류 폴더                                                         |
| `src/renderer/assets/fonts`                                        |         1 |         1 |    0 |      0 |         1 | 유지: 동일 형식의 정적 자산; 코드 모듈 분리 대상 아님                                      |
| `src/renderer/assets/mp4`                                          |         9 |         9 |    0 |      0 |         9 | 유지: 동일 형식의 정적 자산; 코드 모듈 분리 대상 아님                                      |
| `src/renderer/assets/svgs`                                         |        19 |        19 |    0 |      0 |        19 | 유지: 동일 형식의 정적 자산; 코드 모듈 분리 대상 아님                                      |
| `src/renderer/benchmarks`                                          |        37 |         4 |    4 |      2 |        37 | 분류: WebView 공통 진입점·단일 panel/plugin 시나리오 유지                                  |
| `src/renderer/benchmarks/controls`                                 |         0 |        18 |   18 |      9 |        18 | 신설: 해당 상호작용의 측정 화면·시나리오를 함께 배치                                       |
| `src/renderer/benchmarks/grid`                                     |         0 |        12 |   12 |      6 |        12 | 신설: 해당 상호작용의 측정 화면·시나리오를 함께 배치                                       |
| `src/renderer/benchmarks/overlay`                                  |         0 |         3 |    3 |      1 |         3 | 신설: 해당 상호작용의 측정 화면·시나리오를 함께 배치                                       |
| `src/renderer/components`                                          |         0 |         0 |    0 |      0 |       381 | 유지: 하위 영역을 모으는 분류 폴더                                                         |
| `src/renderer/components/main`                                     |         8 |         8 |    8 |      2 |       341 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid`                                |         6 |         6 |    6 |      3 |       170 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel`                |         3 |         3 |    3 |      0 |       124 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/batch`          |        33 |        16 |   16 |      4 |        35 | 분류: 공통 집계·commit·조립부 유지; 다파일 기능만 하위 분류                                |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/geometry` |         0 |         3 |    3 |      1 |         3 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/graph`    |         0 |         4 |    4 |      1 |         4 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/note`     |         0 |         3 |    3 |      1 |         3 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/style`    |         0 |         9 |    9 |      1 |         9 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/controls`       |        12 |        12 |   12 |      2 |        12 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/layer`          |        23 |        23 |   23 |     11 |        23 | 유지: 레이어 조립·선택·DnD·rename의 단일 편집 경계와 전용 테스트 유지                      |
| `src/renderer/components/main/Grid/PropertiesPanel/navigation`     |        13 |        13 |   13 |      3 |        13 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/plugin`         |         3 |         3 |    3 |      0 |         3 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/selection`      |        14 |        14 |   14 |      5 |        14 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/PropertiesPanel/single`         |        21 |        21 |   21 |      7 |        21 | 유지: 단일 선택 route와 타입별 패널 유지; 파일명으로 대상 구별 가능                        |
| `src/renderer/components/main/Grid/core`                           |        14 |        14 |   14 |      6 |        14 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/handles`                        |        13 |        13 |   13 |      5 |        13 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/layers`                         |         9 |         9 |    9 |      3 |         9 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Grid/overlays`                       |         4 |         4 |    4 |      1 |         4 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal`                               |        34 |        11 |   11 |      6 |       104 | 분류: 여러 popup이 쓰는 layer·chrome·exit와 modal 조립부 유지                              |
| `src/renderer/components/main/Modal/content`                       |         0 |         0 |    0 |      0 |        70 | 유지: 하위 영역을 모으는 분류 폴더                                                         |
| `src/renderer/components/main/Modal/content/dialogs`               |         7 |         7 |    7 |      3 |         7 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/content/editors`               |        14 |        14 |   14 |      6 |        14 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/content/managers`              |         9 |         9 |    9 |      4 |         9 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/content/pickers`               |        37 |         9 |    9 |      3 |        37 | 분류: 공유 목록 UI와 독립 picker 유지; color·font·sound 묶음 분류                          |
| `src/renderer/components/main/Modal/content/pickers/color`         |         0 |        14 |   14 |      5 |        14 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/content/pickers/font`          |         0 |        10 |   10 |      4 |        10 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/content/pickers/sound`         |         0 |         4 |    4 |      2 |         4 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/content/settings`              |         3 |         3 |    3 |      1 |         3 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/floatingPopup`                 |         0 |        10 |   10 |      7 |        10 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/listPopup`                     |         0 |         9 |    9 |      6 |         9 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Modal/tooltip`                       |         0 |         4 |    4 |      1 |         4 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/SettingsPanel`                       |         6 |         6 |    6 |      0 |         6 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Tool`                                |        15 |        15 |   15 |      7 |        20 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/Tool/icons`                          |         5 |         5 |    5 |      0 |         5 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/common`                              |        33 |        14 |   14 |      3 |        33 | 분류: 독립 공통 컴포넌트 유지; 다파일 입력 컴포넌트 분류                                   |
| `src/renderer/components/main/common/checkbox`                     |         0 |         5 |    5 |      4 |         5 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/common/dropdown`                     |         0 |         6 |    6 |      4 |         6 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/main/common/numberInput`                  |         0 |         8 |    8 |      3 |         8 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/overlay`                                  |         2 |         2 |    2 |      1 |        14 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/overlay/counters`                         |        12 |        12 |   12 |      3 |        12 | 유지: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/shared`                                   |        26 |         3 |    3 |      1 |        26 | 분류: 장면 조립·KnobFace 유지; key·graph·plugin 표면 분류                                  |
| `src/renderer/components/shared/graph`                             |         0 |         4 |    4 |      2 |         4 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/shared/key`                               |         0 |         5 |    5 |      2 |         5 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/components/shared/plugin`                            |         0 |        14 |   14 |      8 |        14 | 신설: 폴더가 나타내는 UI 역할의 구현·전용 테스트를 함께 유지                               |
| `src/renderer/config`                                              |         1 |         1 |    1 |      0 |         1 | 유지: 앱 설정 유지                                                                         |
| `src/renderer/constants`                                           |         4 |         4 |    4 |      0 |         4 | 유지: 공유 상수 유지                                                                       |
| `src/renderer/contexts`                                            |         5 |         5 |    5 |      0 |         5 | 유지: 공유 context 유지                                                                    |
| `src/renderer/editor`                                              |         0 |         0 |    0 |      0 |        76 | 유지: 하위 영역을 모으는 분류 폴더                                                         |
| `src/renderer/editor/model`                                        |        10 |        10 |   10 |      3 |        10 | 유지: 편집 모델·연산·조정·투영의 기존 책임 경계 유지                                       |
| `src/renderer/editor/runtime`                                      |         0 |         0 |    0 |      0 |        66 | 유지: 하위 영역을 모으는 분류 폴더                                                         |
| `src/renderer/editor/runtime/coordinator`                          |        13 |        13 |   13 |      4 |        13 | 유지: 편집 모델·연산·조정·투영의 기존 책임 경계 유지                                       |
| `src/renderer/editor/runtime/geometry`                             |         4 |         4 |    4 |      2 |         4 | 유지: 편집 모델·연산·조정·투영의 기존 책임 경계 유지                                       |
| `src/renderer/editor/runtime/gesture`                              |         5 |         5 |    5 |      2 |         5 | 유지: 편집 모델·연산·조정·투영의 기존 책임 경계 유지                                       |
| `src/renderer/editor/runtime/intent`                               |        15 |        15 |   15 |      7 |        15 | 유지: 편집 모델·연산·조정·투영의 기존 책임 경계 유지                                       |
| `src/renderer/editor/runtime/lifecycle`                            |        12 |        12 |   12 |      5 |        12 | 유지: 편집 모델·연산·조정·투영의 기존 책임 경계 유지                                       |
| `src/renderer/editor/runtime/operations`                           |        12 |        12 |   12 |      2 |        12 | 유지: 편집 모델·연산·조정·투영의 기존 책임 경계 유지                                       |
| `src/renderer/editor/runtime/projection`                           |         5 |         5 |    5 |      0 |         5 | 유지: 편집 모델·연산·조정·투영의 기존 책임 경계 유지                                       |
| `src/renderer/hooks`                                               |        22 |        22 |   22 |      7 |       127 | 유지: 낙관적 commit·사용자 동작·자원 훅의 기존 공용 진입점 유지; 상태 소유권 재설계와 구분 |
| `src/renderer/hooks/Grid`                                          |        41 |         9 |    9 |      3 |        41 | 분류: 공통 commit·plugin gesture·진입점 유지; 선택·drag·resize·메뉴·viewport 분류          |
| `src/renderer/hooks/Grid/contextMenu`                              |         0 |         6 |    6 |      4 |         6 | 신설: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/Grid/drag`                                     |         0 |        10 |   10 |      5 |        10 | 신설: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/Grid/resize`                                   |         0 |         4 |    4 |      2 |         4 | 신설: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/Grid/selection`                                |         0 |        10 |   10 |      5 |        10 | 신설: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/Grid/viewport`                                 |         0 |         2 |    2 |      1 |         2 | 신설: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/Modal`                                         |         1 |         1 |    1 |      0 |         1 | 유지: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/app`                                           |        12 |        12 |   12 |      5 |        12 | 유지: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/audio`                                         |         2 |         2 |    2 |      1 |         2 | 유지: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/overlay`                                       |        17 |        17 |   17 |      7 |        17 | 유지: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/panel`                                         |         7 |         7 |    7 |      3 |         7 | 유지: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/pickers`                                       |         3 |         3 |    3 |      1 |         3 | 유지: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/shared`                                        |         6 |         6 |    6 |      1 |         6 | 유지: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/hooks/ui`                                            |        16 |        16 |   16 |      2 |        16 | 유지: 해당 화면·동작의 훅과 전용 테스트 유지                                               |
| `src/renderer/locales`                                             |         5 |         5 |    0 |      0 |         5 | 유지: 언어별 번역 유지                                                                     |
| `src/renderer/plugins`                                             |         0 |         0 |    0 |      0 |        58 | 유지: 하위 영역을 모으는 분류 폴더                                                         |
| `src/renderer/plugins/runtime`                                     |        14 |        14 |   14 |      7 |        58 | 유지: 플러그인 권한·수명주기·API·표시 요소의 기존 경계 유지                                |
| `src/renderer/plugins/runtime/api`                                 |        19 |        19 |   19 |      9 |        19 | 유지: 플러그인 권한·수명주기·API·표시 요소의 기존 경계 유지                                |
| `src/renderer/plugins/runtime/context`                             |         4 |         4 |    4 |      1 |         4 | 유지: 플러그인 권한·수명주기·API·표시 요소의 기존 경계 유지                                |
| `src/renderer/plugins/runtime/displayElement`                      |        18 |        18 |   18 |      7 |        18 | 유지: 플러그인 권한·수명주기·API·표시 요소의 기존 경계 유지                                |
| `src/renderer/plugins/runtime/handlers`                            |         3 |         3 |    3 |      1 |         3 | 유지: 플러그인 권한·수명주기·API·표시 요소의 기존 경계 유지                                |
| `src/renderer/stores`                                              |         6 |         6 |    6 |      2 |        41 | 유지: 기존 역할 유지                                                                       |
| `src/renderer/stores/data`                                         |         9 |         9 |    9 |      2 |         9 | 유지: 상태 소유 영역과 실시간 signals의 기존 경계 유지                                     |
| `src/renderer/stores/grid`                                         |        14 |        14 |   14 |      7 |        14 | 유지: 상태 소유 영역과 실시간 signals의 기존 경계 유지                                     |
| `src/renderer/stores/plugin`                                       |         5 |         5 |    5 |      2 |         5 | 유지: 상태 소유 영역과 실시간 signals의 기존 경계 유지                                     |
| `src/renderer/stores/signals`                                      |         7 |         7 |    7 |      1 |         7 | 유지: 상태 소유 영역과 실시간 signals의 기존 경계 유지                                     |
| `src/renderer/styles`                                              |         3 |         3 |    3 |      0 |         3 | 유지: 전역 스타일 유지                                                                     |
| `src/renderer/utils`                                               |        15 |        16 |   16 |      5 |       137 | 분류: 여러 도메인의 기존 공용 진입 파일 유지; 소비 위치별 중복 분리 방지                   |
| `src/renderer/utils/animation`                                     |         7 |         7 |    7 |      2 |         7 | 유지: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/audio`                                         |         2 |         2 |    2 |      1 |         2 | 유지: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/color`                                         |         3 |         3 |    3 |      1 |         3 | 유지: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/core`                                          |        39 |         3 |    3 |      1 |         3 | 분류: 플랫폼 판정·안정 직렬화만 잔류; 단독 기능마다 폴더를 만들지 않음                     |
| `src/renderer/utils/counter`                                       |         1 |         5 |    5 |      1 |         5 | 분류: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/css`                                           |         4 |         4 |    4 |      2 |         6 | 유지: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/css/scopeUserCss`                              |         2 |         2 |    2 |      0 |         2 | 유지: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/dom`                                           |         2 |         3 |    3 |      0 |         3 | 분류: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/element`                                       |         0 |         5 |    5 |      2 |         5 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/focus`                                         |         1 |         1 |    1 |      0 |         1 | 유지: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/grid`                                          |        20 |        23 |   23 |     11 |        28 | 분류: 좌표·선택 계산과 단위 테스트; smartGuides의 기존 하위 경계 유지                      |
| `src/renderer/utils/grid/smartGuides`                              |         5 |         5 |    5 |      0 |         5 | 유지: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/input`                                         |         0 |         4 |    4 |      0 |         4 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/media`                                         |         0 |         7 |    7 |      3 |         7 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/number`                                        |         0 |         3 |    3 |      1 |         3 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/panelWindow`                                   |         6 |         6 |    6 |      3 |         6 | 유지: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/plugin`                                        |        28 |         6 |    6 |      2 |        29 | 분류: bridge·결과 판정·번역·설정 진입점 유지; 구현 묶음은 하위 분류                        |
| `src/renderer/utils/plugin/components`                             |         0 |         4 |    4 |      1 |         4 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/plugin/interactions`                           |         0 |         8 |    8 |      4 |         8 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/plugin/layout`                                 |         0 |         7 |    7 |      3 |         7 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/plugin/menu`                                   |         0 |         4 |    4 |      2 |         4 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/typography`                                    |         0 |         3 |    3 |      1 |         3 | 신설: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/utils/ui`                                            |         4 |         6 |    6 |      2 |         6 | 분류: 폴더명에 해당하는 보조 기능과 테스트를 함께 배치                                     |
| `src/renderer/windows`                                             |         0 |         0 |    0 |      0 |        15 | 유지: 하위 영역을 모으는 분류 폴더                                                         |
| `src/renderer/windows/main`                                        |         7 |         7 |    7 |      2 |         7 | 유지: 창별 실행 진입점과 조립·계약 테스트 유지                                             |
| `src/renderer/windows/obs`                                         |         2 |         2 |    2 |      0 |         2 | 유지: 창별 실행 진입점과 조립·계약 테스트 유지                                             |
| `src/renderer/windows/overlay`                                     |         6 |         6 |    6 |      3 |         6 | 유지: 창별 실행 진입점과 조립·계약 테스트 유지                                             |
| `src/types`                                                        |        11 |        11 |   11 |      1 |        33 | 유지: 공유 계약과 ambient 선언 유지                                                        |
| `src/types/key`                                                    |        13 |        13 |   13 |      4 |        13 | 유지: 도메인별 공유 데이터 계약과 검증 유지                                                |
| `src/types/plugin`                                                 |         3 |         3 |    3 |      0 |         3 | 유지: 도메인별 공유 데이터 계약과 검증 유지                                                |
| `src/types/settings`                                               |         6 |         6 |    6 |      1 |         6 | 유지: 도메인별 공유 데이터 계약과 검증 유지                                                |

## 파일별 이동 목록

이전 경로는 `9a8ad48d` 기준이며 이후 경로는 최종 위치다. 중간 이동은 최종 위치로 합쳤다. 아래 309개 외의 파일은 경로를 유지했다. import·mock·실행 명령·소스 경로 문자열을 참조하는 소비 파일은 별도로 갱신했다.

| 이전 경로                                                                                       | 이후 경로                                                                                             |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/renderer/__tests__/activeStatePickerCapability.test.tsx`                                   | `src/renderer/__tests__/panel/activeStatePickerCapability.test.tsx`                                   |
| `src/renderer/__tests__/batchStyleActiveAggregation.test.tsx`                                   | `src/renderer/__tests__/panel/batchStyleActiveAggregation.test.tsx`                                   |
| `src/renderer/__tests__/batchStyleEditCancel.test.tsx`                                          | `src/renderer/__tests__/panel/batchStyleEditCancel.test.tsx`                                          |
| `src/renderer/__tests__/canvasCursorPolicy.test.ts`                                             | `src/renderer/__tests__/rendering/canvasCursorPolicy.test.ts`                                         |
| `src/renderer/__tests__/colorPaletteStorage.test.ts`                                            | `src/renderer/__tests__/rendering/colorPaletteStorage.test.ts`                                        |
| `src/renderer/__tests__/counterAnimationMerge.test.ts`                                          | `src/renderer/__tests__/rendering/counterAnimationMerge.test.ts`                                      |
| `src/renderer/__tests__/counterAnimationPreviewContract.test.ts`                                | `src/renderer/__tests__/rendering/counterAnimationPreviewContract.test.ts`                            |
| `src/renderer/__tests__/customCssPriorityContract.test.ts`                                      | `src/renderer/__tests__/rendering/customCssPriorityContract.test.ts`                                  |
| `src/renderer/__tests__/defaultBorderRingContract.test.ts`                                      | `src/renderer/__tests__/rendering/defaultBorderRingContract.test.ts`                                  |
| `src/renderer/__tests__/digitPopAnimationContract.test.ts`                                      | `src/renderer/__tests__/rendering/digitPopAnimationContract.test.ts`                                  |
| `src/renderer/__tests__/editorDocumentSelection.test.ts`                                        | `src/renderer/__tests__/editor/editorDocumentSelection.test.ts`                                       |
| `src/renderer/__tests__/elementShadowContract.test.ts`                                          | `src/renderer/__tests__/rendering/elementShadowContract.test.ts`                                      |
| `src/renderer/__tests__/floatingPopupLayerOwnership.test.tsx`                                   | `src/renderer/__tests__/popup/floatingPopupLayerOwnership.test.tsx`                                   |
| `src/renderer/__tests__/glassCanvasSurfaceContract.test.ts`                                     | `src/renderer/__tests__/rendering/glassCanvasSurfaceContract.test.ts`                                 |
| `src/renderer/__tests__/gooeySpringResilience.test.tsx`                                         | `src/renderer/__tests__/rendering/gooeySpringResilience.test.tsx`                                     |
| `src/renderer/__tests__/gradientAxisHandle.test.tsx`                                            | `src/renderer/__tests__/rendering/gradientAxisHandle.test.tsx`                                        |
| `src/renderer/__tests__/gradientColorState.test.tsx`                                            | `src/renderer/__tests__/editor/gradientColorState.test.tsx`                                           |
| `src/renderer/__tests__/gradientEditStore.test.tsx`                                             | `src/renderer/__tests__/editor/gradientEditStore.test.tsx`                                            |
| `src/renderer/__tests__/historyTickCancel.test.tsx`                                             | `src/renderer/__tests__/editor/historyTickCancel.test.tsx`                                            |
| `src/renderer/__tests__/imageLayerStyles.test.ts`                                               | `src/renderer/__tests__/rendering/imageLayerStyles.test.ts`                                           |
| `src/renderer/__tests__/keyDeletionSelection.test.tsx`                                          | `src/renderer/__tests__/editor/keyDeletionSelection.test.tsx`                                         |
| `src/renderer/__tests__/keyStatsDedupe.test.ts`                                                 | `src/renderer/__tests__/rendering/keyStatsDedupe.test.ts`                                             |
| `src/renderer/__tests__/knobIndicatorColor.test.tsx`                                            | `src/renderer/__tests__/rendering/knobIndicatorColor.test.tsx`                                        |
| `src/renderer/__tests__/modalInitialFocusModality.test.tsx`                                     | `src/renderer/__tests__/popup/modalInitialFocusModality.test.tsx`                                     |
| `src/renderer/__tests__/motionReductionPolicy.test.ts`                                          | `src/renderer/__tests__/rendering/motionReductionPolicy.test.ts`                                      |
| `src/renderer/__tests__/overlayCommitBudget.test.tsx`                                           | `src/renderer/__tests__/rendering/overlayCommitBudget.test.tsx`                                       |
| `src/renderer/__tests__/panelAnchoredPopupPosition.test.ts`                                     | `src/renderer/__tests__/popup/panelAnchoredPopupPosition.test.ts`                                     |
| `src/renderer/__tests__/pickerSurfacePlacement.test.tsx`                                        | `src/renderer/__tests__/popup/pickerSurfacePlacement.test.tsx`                                        |
| `src/renderer/__tests__/placeholderFocusContract.test.ts`                                       | `src/renderer/__tests__/popup/placeholderFocusContract.test.ts`                                       |
| `src/renderer/__tests__/pluginElementIsolation.test.tsx`                                        | `src/renderer/__tests__/plugin/pluginElementIsolation.test.tsx`                                       |
| `src/renderer/__tests__/pluginElementStoreIdentity.test.ts`                                     | `src/renderer/__tests__/plugin/pluginElementStoreIdentity.test.ts`                                    |
| `src/renderer/__tests__/pointerFocusGuard.test.ts`                                              | `src/renderer/__tests__/popup/pointerFocusGuard.test.ts`                                              |
| `src/renderer/__tests__/popupMotionCssContract.test.ts`                                         | `src/renderer/__tests__/popup/popupMotionCssContract.test.ts`                                         |
| `src/renderer/__tests__/presetLoadSelection.test.tsx`                                           | `src/renderer/__tests__/editor/presetLoadSelection.test.tsx`                                          |
| `src/renderer/__tests__/previewOverlaySession.test.ts`                                          | `src/renderer/__tests__/editor/previewOverlaySession.test.ts`                                         |
| `src/renderer/__tests__/renderedElementContract.test.tsx`                                       | `src/renderer/__tests__/rendering/renderedElementContract.test.tsx`                                   |
| `src/renderer/__tests__/shadowControls.test.tsx`                                                | `src/renderer/__tests__/panel/shadowControls.test.tsx`                                                |
| `src/renderer/__tests__/singleActiveStateCapability.test.tsx`                                   | `src/renderer/__tests__/panel/singleActiveStateCapability.test.tsx`                                   |
| `src/renderer/__tests__/zIndexLayerContract.test.ts`                                            | `src/renderer/__tests__/rendering/zIndexLayerContract.test.ts`                                        |
| `src/renderer/api/modules/appApi.test.ts`                                                       | `src/renderer/api/modules/app/appApi.test.ts`                                                         |
| `src/renderer/api/modules/appApi.ts`                                                            | `src/renderer/api/modules/app/appApi.ts`                                                              |
| `src/renderer/api/modules/bridgeApi.test.ts`                                                    | `src/renderer/api/modules/plugin/bridgeApi.test.ts`                                                   |
| `src/renderer/api/modules/bridgeApi.ts`                                                         | `src/renderer/api/modules/plugin/bridgeApi.ts`                                                        |
| `src/renderer/api/modules/cssApi.ts`                                                            | `src/renderer/api/modules/resources/cssApi.ts`                                                        |
| `src/renderer/api/modules/customCssImportApi.ts`                                                | `src/renderer/api/modules/resources/customCssImportApi.ts`                                            |
| `src/renderer/api/modules/editorAdapters.test.ts`                                               | `src/renderer/api/modules/editor/editorAdapters.test.ts`                                              |
| `src/renderer/api/modules/editorApi.test.ts`                                                    | `src/renderer/api/modules/editor/editorApi.test.ts`                                                   |
| `src/renderer/api/modules/editorApi.ts`                                                         | `src/renderer/api/modules/editor/editorApi.ts`                                                        |
| `src/renderer/api/modules/gestureApi.test.ts`                                                   | `src/renderer/api/modules/editor/gestureApi.test.ts`                                                  |
| `src/renderer/api/modules/gestureApi.ts`                                                        | `src/renderer/api/modules/editor/gestureApi.ts`                                                       |
| `src/renderer/api/modules/historyApi.ts`                                                        | `src/renderer/api/modules/editor/historyApi.ts`                                                       |
| `src/renderer/api/modules/i18nApi.ts`                                                           | `src/renderer/api/modules/app/i18nApi.ts`                                                             |
| `src/renderer/api/modules/itemsApi.ts`                                                          | `src/renderer/api/modules/editor/itemsApi.ts`                                                         |
| `src/renderer/api/modules/jsApi.ts`                                                             | `src/renderer/api/modules/plugin/jsApi.ts`                                                            |
| `src/renderer/api/modules/keyModeApi.ts`                                                        | `src/renderer/api/modules/editor/keyModeApi.ts`                                                       |
| `src/renderer/api/modules/keysApi.test.ts`                                                      | `src/renderer/api/modules/editor/keysApi.test.ts`                                                     |
| `src/renderer/api/modules/keysApi.ts`                                                           | `src/renderer/api/modules/editor/keysApi.ts`                                                          |
| `src/renderer/api/modules/legacyMutationRouting.test.ts`                                        | `src/renderer/api/modules/editor/legacyMutationRouting.test.ts`                                       |
| `src/renderer/api/modules/noteTabApi.ts`                                                        | `src/renderer/api/modules/editor/noteTabApi.ts`                                                       |
| `src/renderer/api/modules/obsApi.ts`                                                            | `src/renderer/api/modules/window/obsApi.ts`                                                           |
| `src/renderer/api/modules/overlayApi.ts`                                                        | `src/renderer/api/modules/window/overlayApi.ts`                                                       |
| `src/renderer/api/modules/panelWindowApi.test.ts`                                               | `src/renderer/api/modules/window/panelWindowApi.test.ts`                                              |
| `src/renderer/api/modules/panelWindowApi.ts`                                                    | `src/renderer/api/modules/window/panelWindowApi.ts`                                                   |
| `src/renderer/api/modules/pluginApi.ts`                                                         | `src/renderer/api/modules/plugin/pluginApi.ts`                                                        |
| `src/renderer/api/modules/pluginAuthorityApi.ts`                                                | `src/renderer/api/modules/plugin/pluginAuthorityApi.ts`                                               |
| `src/renderer/api/modules/pluginInstancesApi.test.ts`                                           | `src/renderer/api/modules/plugin/pluginInstancesApi.test.ts`                                          |
| `src/renderer/api/modules/pluginInstancesApi.ts`                                                | `src/renderer/api/modules/plugin/pluginInstancesApi.ts`                                               |
| `src/renderer/api/modules/presetsApi.ts`                                                        | `src/renderer/api/modules/resources/presetsApi.ts`                                                    |
| `src/renderer/api/modules/previewApi.ts`                                                        | `src/renderer/api/modules/editor/previewApi.ts`                                                       |
| `src/renderer/api/modules/resourceApi.ts`                                                       | `src/renderer/api/modules/resources/resourceApi.ts`                                                   |
| `src/renderer/api/modules/settingsApi.ts`                                                       | `src/renderer/api/modules/app/settingsApi.ts`                                                         |
| `src/renderer/api/modules/statsApi.ts`                                                          | `src/renderer/api/modules/app/statsApi.ts`                                                            |
| `src/renderer/api/modules/uiApi.contextMenu.test.ts`                                            | `src/renderer/api/modules/window/uiApi.contextMenu.test.ts`                                           |
| `src/renderer/api/modules/uiApi.ts`                                                             | `src/renderer/api/modules/window/uiApi.ts`                                                            |
| `src/renderer/benchmarks/colorInput.performance.test.tsx`                                       | `src/renderer/benchmarks/controls/colorInput.performance.test.tsx`                                    |
| `src/renderer/benchmarks/colorInputBenchmark.tsx`                                               | `src/renderer/benchmarks/controls/colorInputBenchmark.tsx`                                            |
| `src/renderer/benchmarks/colorTrack.performance.test.tsx`                                       | `src/renderer/benchmarks/controls/colorTrack.performance.test.tsx`                                    |
| `src/renderer/benchmarks/colorTrackBenchmark.tsx`                                               | `src/renderer/benchmarks/controls/colorTrackBenchmark.tsx`                                            |
| `src/renderer/benchmarks/dropdown.performance.test.tsx`                                         | `src/renderer/benchmarks/controls/dropdown.performance.test.tsx`                                      |
| `src/renderer/benchmarks/dropdownBenchmark.tsx`                                                 | `src/renderer/benchmarks/controls/dropdownBenchmark.tsx`                                              |
| `src/renderer/benchmarks/floatingPopup.performance.test.tsx`                                    | `src/renderer/benchmarks/controls/floatingPopup.performance.test.tsx`                                 |
| `src/renderer/benchmarks/floatingPopupBenchmark.tsx`                                            | `src/renderer/benchmarks/controls/floatingPopupBenchmark.tsx`                                         |
| `src/renderer/benchmarks/gradientAxis.performance.test.tsx`                                     | `src/renderer/benchmarks/grid/gradientAxis.performance.test.tsx`                                      |
| `src/renderer/benchmarks/gradientAxisBenchmark.tsx`                                             | `src/renderer/benchmarks/grid/gradientAxisBenchmark.tsx`                                              |
| `src/renderer/benchmarks/gridContinuousInput.performance.test.tsx`                              | `src/renderer/benchmarks/grid/gridContinuousInput.performance.test.tsx`                               |
| `src/renderer/benchmarks/gridContinuousInputBenchmark.tsx`                                      | `src/renderer/benchmarks/grid/gridContinuousInputBenchmark.tsx`                                       |
| `src/renderer/benchmarks/gridKeyboard.performance.test.tsx`                                     | `src/renderer/benchmarks/grid/gridKeyboard.performance.test.tsx`                                      |
| `src/renderer/benchmarks/gridKeyboardBenchmark.tsx`                                             | `src/renderer/benchmarks/grid/gridKeyboardBenchmark.tsx`                                              |
| `src/renderer/benchmarks/gridMarquee.performance.test.tsx`                                      | `src/renderer/benchmarks/grid/gridMarquee.performance.test.tsx`                                       |
| `src/renderer/benchmarks/gridMarqueeBenchmark.tsx`                                              | `src/renderer/benchmarks/grid/gridMarqueeBenchmark.tsx`                                               |
| `src/renderer/benchmarks/gridMinimap.performance.test.tsx`                                      | `src/renderer/benchmarks/grid/gridMinimap.performance.test.tsx`                                       |
| `src/renderer/benchmarks/gridMinimapBenchmark.tsx`                                              | `src/renderer/benchmarks/grid/gridMinimapBenchmark.tsx`                                               |
| `src/renderer/benchmarks/gridResize.performance.test.tsx`                                       | `src/renderer/benchmarks/grid/gridResize.performance.test.tsx`                                        |
| `src/renderer/benchmarks/gridResizeBenchmark.tsx`                                               | `src/renderer/benchmarks/grid/gridResizeBenchmark.tsx`                                                |
| `src/renderer/benchmarks/modal.performance.test.tsx`                                            | `src/renderer/benchmarks/controls/modal.performance.test.tsx`                                         |
| `src/renderer/benchmarks/modalBenchmark.tsx`                                                    | `src/renderer/benchmarks/controls/modalBenchmark.tsx`                                                 |
| `src/renderer/benchmarks/numberInput.performance.test.tsx`                                      | `src/renderer/benchmarks/controls/numberInput.performance.test.tsx`                                   |
| `src/renderer/benchmarks/numberInputBenchmark.tsx`                                              | `src/renderer/benchmarks/controls/numberInputBenchmark.tsx`                                           |
| `src/renderer/benchmarks/overlayCounter.performance.test.tsx`                                   | `src/renderer/benchmarks/overlay/overlayCounter.performance.test.tsx`                                 |
| `src/renderer/benchmarks/overlayCounterBenchmark.tsx`                                           | `src/renderer/benchmarks/overlay/overlayCounterBenchmark.tsx`                                         |
| `src/renderer/benchmarks/overlayCounterBenchmarkSupport.ts`                                     | `src/renderer/benchmarks/overlay/overlayCounterBenchmarkSupport.ts`                                   |
| `src/renderer/benchmarks/shadowToggle.performance.test.tsx`                                     | `src/renderer/benchmarks/controls/shadowToggle.performance.test.tsx`                                  |
| `src/renderer/benchmarks/shadowToggleBenchmark.tsx`                                             | `src/renderer/benchmarks/controls/shadowToggleBenchmark.tsx`                                          |
| `src/renderer/benchmarks/tabSwitch.performance.test.tsx`                                        | `src/renderer/benchmarks/controls/tabSwitch.performance.test.tsx`                                     |
| `src/renderer/benchmarks/tabSwitchBenchmark.tsx`                                                | `src/renderer/benchmarks/controls/tabSwitchBenchmark.tsx`                                             |
| `src/renderer/benchmarks/textInput.performance.test.tsx`                                        | `src/renderer/benchmarks/controls/textInput.performance.test.tsx`                                     |
| `src/renderer/benchmarks/textInputBenchmark.tsx`                                                | `src/renderer/benchmarks/controls/textInputBenchmark.tsx`                                             |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchColorPickerPopup.tsx`             | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/BatchColorPickerPopup.tsx`             |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchGeometrySection.test.tsx`         | `src/renderer/components/main/Grid/PropertiesPanel/batch/geometry/BatchGeometrySection.test.tsx`      |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchGeometrySection.tsx`              | `src/renderer/components/main/Grid/PropertiesPanel/batch/geometry/BatchGeometrySection.tsx`           |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchGraphOnlyPanel.tsx`               | `src/renderer/components/main/Grid/PropertiesPanel/batch/graph/BatchGraphOnlyPanel.tsx`               |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchGraphSettingsSection.tsx`         | `src/renderer/components/main/Grid/PropertiesPanel/batch/graph/BatchGraphSettingsSection.tsx`         |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchImagePickerPopup.tsx`             | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/BatchImagePickerPopup.tsx`             |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchNoteTabContent.tsx`               | `src/renderer/components/main/Grid/PropertiesPanel/batch/note/BatchNoteTabContent.tsx`                |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchShadowSection.tsx`                | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/BatchShadowSection.tsx`                |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchSoundSection.tsx`                 | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/BatchSoundSection.tsx`                 |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchStyleTabContent.tsx`              | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/BatchStyleTabContent.tsx`              |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/BatchTypographySection.tsx`            | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/BatchTypographySection.tsx`            |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/batchGraphSettingsModel.test.ts`       | `src/renderer/components/main/Grid/PropertiesPanel/batch/graph/batchGraphSettingsModel.test.ts`       |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/batchGraphSettingsModel.ts`            | `src/renderer/components/main/Grid/PropertiesPanel/batch/graph/batchGraphSettingsModel.ts`            |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/batchPickerBindingOwnership.test.tsx`  | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/batchPickerBindingOwnership.test.tsx`  |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/batchPickerTypes.ts`                   | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/batchPickerTypes.ts`                   |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/useBatchColorPickerController.ts`      | `src/renderer/components/main/Grid/PropertiesPanel/batch/style/useBatchColorPickerController.ts`      |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/useBatchNotePaint.test.tsx`            | `src/renderer/components/main/Grid/PropertiesPanel/batch/note/useBatchNotePaint.test.tsx`             |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/useBatchNotePaint.tsx`                 | `src/renderer/components/main/Grid/PropertiesPanel/batch/note/useBatchNotePaint.tsx`                  |
| `src/renderer/components/main/Grid/PropertiesPanel/batch/usePropertiesPanelBatchGeometry.ts`    | `src/renderer/components/main/Grid/PropertiesPanel/batch/geometry/usePropertiesPanelBatchGeometry.ts` |
| `src/renderer/components/main/Modal/FloatingPopup.dismiss.test.tsx`                             | `src/renderer/components/main/Modal/floatingPopup/FloatingPopup.dismiss.test.tsx`                     |
| `src/renderer/components/main/Modal/FloatingPopup.edgeClamp.test.tsx`                           | `src/renderer/components/main/Modal/floatingPopup/FloatingPopup.edgeClamp.test.tsx`                   |
| `src/renderer/components/main/Modal/FloatingPopup.modalClose.test.tsx`                          | `src/renderer/components/main/Modal/floatingPopup/FloatingPopup.modalClose.test.tsx`                  |
| `src/renderer/components/main/Modal/FloatingPopup.motion.test.tsx`                              | `src/renderer/components/main/Modal/floatingPopup/FloatingPopup.motion.test.tsx`                      |
| `src/renderer/components/main/Modal/FloatingPopup.reference.test.tsx`                           | `src/renderer/components/main/Modal/floatingPopup/FloatingPopup.reference.test.tsx`                   |
| `src/renderer/components/main/Modal/FloatingPopup.referenceLoop.test.tsx`                       | `src/renderer/components/main/Modal/floatingPopup/FloatingPopup.referenceLoop.test.tsx`               |
| `src/renderer/components/main/Modal/FloatingPopup.test.tsx`                                     | `src/renderer/components/main/Modal/floatingPopup/FloatingPopup.test.tsx`                             |
| `src/renderer/components/main/Modal/FloatingPopup.tsx`                                          | `src/renderer/components/main/Modal/floatingPopup/FloatingPopup.tsx`                                  |
| `src/renderer/components/main/Modal/FloatingTooltip.modalClose.test.tsx`                        | `src/renderer/components/main/Modal/tooltip/FloatingTooltip.modalClose.test.tsx`                      |
| `src/renderer/components/main/Modal/FloatingTooltip.tsx`                                        | `src/renderer/components/main/Modal/tooltip/FloatingTooltip.tsx`                                      |
| `src/renderer/components/main/Modal/ListPopup.subMenuClamp.test.tsx`                            | `src/renderer/components/main/Modal/listPopup/ListPopup.subMenuClamp.test.tsx`                        |
| `src/renderer/components/main/Modal/ListPopup.subMenuScroll.test.tsx`                           | `src/renderer/components/main/Modal/listPopup/ListPopup.subMenuScroll.test.tsx`                       |
| `src/renderer/components/main/Modal/ListPopup.subMenuSwitch.test.tsx`                           | `src/renderer/components/main/Modal/listPopup/ListPopup.subMenuSwitch.test.tsx`                       |
| `src/renderer/components/main/Modal/ListPopup.surfaceProps.test.tsx`                            | `src/renderer/components/main/Modal/listPopup/ListPopup.surfaceProps.test.tsx`                        |
| `src/renderer/components/main/Modal/ListPopup.test.tsx`                                         | `src/renderer/components/main/Modal/listPopup/ListPopup.test.tsx`                                     |
| `src/renderer/components/main/Modal/ListPopup.tsx`                                              | `src/renderer/components/main/Modal/listPopup/ListPopup.tsx`                                          |
| `src/renderer/components/main/Modal/TooltipGroup.tsx`                                           | `src/renderer/components/main/Modal/tooltip/TooltipGroup.tsx`                                         |
| `src/renderer/components/main/Modal/TooltipGroupContext.ts`                                     | `src/renderer/components/main/Modal/tooltip/TooltipGroupContext.ts`                                   |
| `src/renderer/components/main/Modal/content/pickers/ColorPicker.percentInput.test.tsx`          | `src/renderer/components/main/Modal/content/pickers/color/ColorPicker.percentInput.test.tsx`          |
| `src/renderer/components/main/Modal/content/pickers/ColorPicker.tsx`                            | `src/renderer/components/main/Modal/content/pickers/color/ColorPicker.tsx`                            |
| `src/renderer/components/main/Modal/content/pickers/ColorPickerControls.tsx`                    | `src/renderer/components/main/Modal/content/pickers/color/ColorPickerControls.tsx`                    |
| `src/renderer/components/main/Modal/content/pickers/ColorPickerInputs.tsx`                      | `src/renderer/components/main/Modal/content/pickers/color/ColorPickerInputs.tsx`                      |
| `src/renderer/components/main/Modal/content/pickers/ColorSwatch.tsx`                            | `src/renderer/components/main/Modal/content/pickers/color/ColorSwatch.tsx`                            |
| `src/renderer/components/main/Modal/content/pickers/FontPicker.tsx`                             | `src/renderer/components/main/Modal/content/pickers/font/FontPicker.tsx`                              |
| `src/renderer/components/main/Modal/content/pickers/FontPickerOpenButton.test.tsx`              | `src/renderer/components/main/Modal/content/pickers/font/FontPickerOpenButton.test.tsx`               |
| `src/renderer/components/main/Modal/content/pickers/FontPickerOpenButton.tsx`                   | `src/renderer/components/main/Modal/content/pickers/font/FontPickerOpenButton.tsx`                    |
| `src/renderer/components/main/Modal/content/pickers/GooeyThumb.tsx`                             | `src/renderer/components/main/Modal/content/pickers/color/GooeyThumb.tsx`                             |
| `src/renderer/components/main/Modal/content/pickers/GradientFormatControls.tsx`                 | `src/renderer/components/main/Modal/content/pickers/color/GradientFormatControls.tsx`                 |
| `src/renderer/components/main/Modal/content/pickers/Palette.test.tsx`                           | `src/renderer/components/main/Modal/content/pickers/color/Palette.test.tsx`                           |
| `src/renderer/components/main/Modal/content/pickers/Palette.tsx`                                | `src/renderer/components/main/Modal/content/pickers/color/Palette.tsx`                                |
| `src/renderer/components/main/Modal/content/pickers/SoundPicker.editSession.test.tsx`           | `src/renderer/components/main/Modal/content/pickers/sound/SoundPicker.editSession.test.tsx`           |
| `src/renderer/components/main/Modal/content/pickers/SoundPicker.runtime.test.tsx`               | `src/renderer/components/main/Modal/content/pickers/sound/SoundPicker.runtime.test.tsx`               |
| `src/renderer/components/main/Modal/content/pickers/SoundPicker.tsx`                            | `src/renderer/components/main/Modal/content/pickers/sound/SoundPicker.tsx`                            |
| `src/renderer/components/main/Modal/content/pickers/WebFontEditorSheet.test.tsx`                | `src/renderer/components/main/Modal/content/pickers/font/WebFontEditorSheet.test.tsx`                 |
| `src/renderer/components/main/Modal/content/pickers/WebFontEditorSheet.tsx`                     | `src/renderer/components/main/Modal/content/pickers/font/WebFontEditorSheet.tsx`                      |
| `src/renderer/components/main/Modal/content/pickers/WebFontInputModal.test.tsx`                 | `src/renderer/components/main/Modal/content/pickers/font/WebFontInputModal.test.tsx`                  |
| `src/renderer/components/main/Modal/content/pickers/WebFontInputModal.tsx`                      | `src/renderer/components/main/Modal/content/pickers/font/WebFontInputModal.tsx`                       |
| `src/renderer/components/main/Modal/content/pickers/colorPickerPrimitives.childWindow.test.tsx` | `src/renderer/components/main/Modal/content/pickers/color/colorPickerPrimitives.childWindow.test.tsx` |
| `src/renderer/components/main/Modal/content/pickers/colorPickerPrimitives.editSession.test.tsx` | `src/renderer/components/main/Modal/content/pickers/color/colorPickerPrimitives.editSession.test.tsx` |
| `src/renderer/components/main/Modal/content/pickers/colorPickerPrimitives.test.tsx`             | `src/renderer/components/main/Modal/content/pickers/color/colorPickerPrimitives.test.tsx`             |
| `src/renderer/components/main/Modal/content/pickers/colorPickerPrimitives.tsx`                  | `src/renderer/components/main/Modal/content/pickers/color/colorPickerPrimitives.tsx`                  |
| `src/renderer/components/main/Modal/content/pickers/fontPickerPreload.test.ts`                  | `src/renderer/components/main/Modal/content/pickers/font/fontPickerPreload.test.ts`                   |
| `src/renderer/components/main/Modal/content/pickers/fontPickerPreload.ts`                       | `src/renderer/components/main/Modal/content/pickers/font/fontPickerPreload.ts`                        |
| `src/renderer/components/main/Modal/content/pickers/useColorPickerInputSession.ts`              | `src/renderer/components/main/Modal/content/pickers/color/useColorPickerInputSession.ts`              |
| `src/renderer/components/main/Modal/content/pickers/useSoundPickerLibraryRuntime.ts`            | `src/renderer/components/main/Modal/content/pickers/sound/useSoundPickerLibraryRuntime.ts`            |
| `src/renderer/components/main/Modal/content/pickers/webFontEditorLoader.ts`                     | `src/renderer/components/main/Modal/content/pickers/font/webFontEditorLoader.ts`                      |
| `src/renderer/components/main/Modal/floatingPopupMotion.ts`                                     | `src/renderer/components/main/Modal/floatingPopup/floatingPopupMotion.ts`                             |
| `src/renderer/components/main/Modal/listPopupMenuRows.tsx`                                      | `src/renderer/components/main/Modal/listPopup/listPopupMenuRows.tsx`                                  |
| `src/renderer/components/main/Modal/listScrollMetrics.test.ts`                                  | `src/renderer/components/main/Modal/listPopup/listScrollMetrics.test.ts`                              |
| `src/renderer/components/main/Modal/listScrollMetrics.ts`                                       | `src/renderer/components/main/Modal/listPopup/listScrollMetrics.ts`                                   |
| `src/renderer/components/main/Modal/useFloatingPopupDismissRuntime.ts`                          | `src/renderer/components/main/Modal/floatingPopup/useFloatingPopupDismissRuntime.ts`                  |
| `src/renderer/components/main/common/Checkbox.childWindow.test.tsx`                             | `src/renderer/components/main/common/checkbox/Checkbox.childWindow.test.tsx`                          |
| `src/renderer/components/main/common/Checkbox.commitChildWindow.test.tsx`                       | `src/renderer/components/main/common/checkbox/Checkbox.commitChildWindow.test.tsx`                    |
| `src/renderer/components/main/common/Checkbox.drag.test.tsx`                                    | `src/renderer/components/main/common/checkbox/Checkbox.drag.test.tsx`                                 |
| `src/renderer/components/main/common/Checkbox.test.tsx`                                         | `src/renderer/components/main/common/checkbox/Checkbox.test.tsx`                                      |
| `src/renderer/components/main/common/Checkbox.tsx`                                              | `src/renderer/components/main/common/checkbox/Checkbox.tsx`                                           |
| `src/renderer/components/main/common/Dropdown.edgeClamp.test.tsx`                               | `src/renderer/components/main/common/dropdown/Dropdown.edgeClamp.test.tsx`                            |
| `src/renderer/components/main/common/Dropdown.modalClose.test.tsx`                              | `src/renderer/components/main/common/dropdown/Dropdown.modalClose.test.tsx`                           |
| `src/renderer/components/main/common/Dropdown.runtime.test.tsx`                                 | `src/renderer/components/main/common/dropdown/Dropdown.runtime.test.tsx`                              |
| `src/renderer/components/main/common/Dropdown.test.tsx`                                         | `src/renderer/components/main/common/dropdown/Dropdown.test.tsx`                                      |
| `src/renderer/components/main/common/Dropdown.tsx`                                              | `src/renderer/components/main/common/dropdown/Dropdown.tsx`                                           |
| `src/renderer/components/main/common/NumberInput.policy.test.tsx`                               | `src/renderer/components/main/common/numberInput/NumberInput.policy.test.tsx`                         |
| `src/renderer/components/main/common/NumberInput.scrub.test.tsx`                                | `src/renderer/components/main/common/numberInput/NumberInput.scrub.test.tsx`                          |
| `src/renderer/components/main/common/NumberInput.tsx`                                           | `src/renderer/components/main/common/numberInput/NumberInput.tsx`                                     |
| `src/renderer/components/main/common/NumberInputChrome.tsx`                                     | `src/renderer/components/main/common/numberInput/NumberInputChrome.tsx`                               |
| `src/renderer/components/main/common/numberInputModel.test.ts`                                  | `src/renderer/components/main/common/numberInput/numberInputModel.test.ts`                            |
| `src/renderer/components/main/common/numberInputModel.ts`                                       | `src/renderer/components/main/common/numberInput/numberInputModel.ts`                                 |
| `src/renderer/components/main/common/numericEditSessionModel.ts`                                | `src/renderer/components/main/common/numberInput/numericEditSessionModel.ts`                          |
| `src/renderer/components/main/common/useDropdownRuntime.tsx`                                    | `src/renderer/components/main/common/dropdown/useDropdownRuntime.tsx`                                 |
| `src/renderer/components/main/common/useNumericEditSession.ts`                                  | `src/renderer/components/main/common/numberInput/useNumericEditSession.ts`                            |
| `src/renderer/components/shared/GraphPanel.animation.test.tsx`                                  | `src/renderer/components/shared/graph/GraphPanel.animation.test.tsx`                                  |
| `src/renderer/components/shared/GraphPanel.loop.test.tsx`                                       | `src/renderer/components/shared/graph/GraphPanel.loop.test.tsx`                                       |
| `src/renderer/components/shared/GraphPanel.tsx`                                                 | `src/renderer/components/shared/graph/GraphPanel.tsx`                                                 |
| `src/renderer/components/shared/Key.statePreview.test.tsx`                                      | `src/renderer/components/shared/key/Key.statePreview.test.tsx`                                        |
| `src/renderer/components/shared/Key.trailingClick.test.tsx`                                     | `src/renderer/components/shared/key/Key.trailingClick.test.tsx`                                       |
| `src/renderer/components/shared/Key.tsx`                                                        | `src/renderer/components/shared/key/Key.tsx`                                                          |
| `src/renderer/components/shared/KeyElementFace.tsx`                                             | `src/renderer/components/shared/key/KeyElementFace.tsx`                                               |
| `src/renderer/components/shared/KeyLabel.tsx`                                                   | `src/renderer/components/shared/key/KeyLabel.tsx`                                                     |
| `src/renderer/components/shared/PluginElement.contextMenuFreeze.test.tsx`                       | `src/renderer/components/shared/plugin/PluginElement.contextMenuFreeze.test.tsx`                      |
| `src/renderer/components/shared/PluginElement.cursorPolicy.test.tsx`                            | `src/renderer/components/shared/plugin/PluginElement.cursorPolicy.test.tsx`                           |
| `src/renderer/components/shared/PluginElement.groupClick.test.tsx`                              | `src/renderer/components/shared/plugin/PluginElement.groupClick.test.tsx`                             |
| `src/renderer/components/shared/PluginElement.legacyHtmlStability.test.tsx`                     | `src/renderer/components/shared/plugin/PluginElement.legacyHtmlStability.test.tsx`                    |
| `src/renderer/components/shared/PluginElement.measurementRuntime.test.tsx`                      | `src/renderer/components/shared/plugin/PluginElement.measurementRuntime.test.tsx`                     |
| `src/renderer/components/shared/PluginElement.mountErrorIsolation.test.tsx`                     | `src/renderer/components/shared/plugin/PluginElement.mountErrorIsolation.test.tsx`                    |
| `src/renderer/components/shared/PluginElement.runtime.test.tsx`                                 | `src/renderer/components/shared/plugin/PluginElement.runtime.test.tsx`                                |
| `src/renderer/components/shared/PluginElement.tsx`                                              | `src/renderer/components/shared/plugin/PluginElement.tsx`                                             |
| `src/renderer/components/shared/PluginElementHost.tsx`                                          | `src/renderer/components/shared/plugin/PluginElementHost.tsx`                                         |
| `src/renderer/components/shared/PluginElementsRenderer.rerenderIsolation.test.tsx`              | `src/renderer/components/shared/plugin/PluginElementsRenderer.rerenderIsolation.test.tsx`             |
| `src/renderer/components/shared/PluginElementsRenderer.tsx`                                     | `src/renderer/components/shared/plugin/PluginElementsRenderer.tsx`                                    |
| `src/renderer/components/shared/useAnimatedGraphHistory.ts`                                     | `src/renderer/components/shared/graph/useAnimatedGraphHistory.ts`                                     |
| `src/renderer/components/shared/usePluginElementContextMenu.tsx`                                | `src/renderer/components/shared/plugin/usePluginElementContextMenu.tsx`                               |
| `src/renderer/components/shared/usePluginElementMeasurementRuntime.ts`                          | `src/renderer/components/shared/plugin/usePluginElementMeasurementRuntime.ts`                         |
| `src/renderer/components/shared/usePluginElementOverlayRuntime.ts`                              | `src/renderer/components/shared/plugin/usePluginElementOverlayRuntime.ts`                             |
| `src/renderer/hooks/Grid/dragSession.ts`                                                        | `src/renderer/hooks/Grid/drag/dragSession.ts`                                                         |
| `src/renderer/hooks/Grid/mixedDragSettlement.e2e.test.tsx`                                      | `src/renderer/hooks/Grid/drag/mixedDragSettlement.e2e.test.tsx`                                       |
| `src/renderer/hooks/Grid/pasteSelection.ts`                                                     | `src/renderer/hooks/Grid/selection/pasteSelection.ts`                                                 |
| `src/renderer/hooks/Grid/resizePreviewPlan.test.ts`                                             | `src/renderer/hooks/Grid/resize/resizePreviewPlan.test.ts`                                            |
| `src/renderer/hooks/Grid/resizePreviewPlan.ts`                                                  | `src/renderer/hooks/Grid/resize/resizePreviewPlan.ts`                                                 |
| `src/renderer/hooks/Grid/useDraggable.smartSnap.test.tsx`                                       | `src/renderer/hooks/Grid/drag/useDraggable.smartSnap.test.tsx`                                        |
| `src/renderer/hooks/Grid/useDraggable.test.tsx`                                                 | `src/renderer/hooks/Grid/drag/useDraggable.test.tsx`                                                  |
| `src/renderer/hooks/Grid/useDraggable.ts`                                                       | `src/renderer/hooks/Grid/drag/useDraggable.ts`                                                        |
| `src/renderer/hooks/Grid/useGridCanvasActions.test.tsx`                                         | `src/renderer/hooks/Grid/contextMenu/useGridCanvasActions.test.tsx`                                   |
| `src/renderer/hooks/Grid/useGridCanvasActions.ts`                                               | `src/renderer/hooks/Grid/contextMenu/useGridCanvasActions.ts`                                         |
| `src/renderer/hooks/Grid/useGridContextMenu.gridMenu.test.tsx`                                  | `src/renderer/hooks/Grid/contextMenu/useGridContextMenu.gridMenu.test.tsx`                            |
| `src/renderer/hooks/Grid/useGridContextMenu.pluginGroup.test.tsx`                               | `src/renderer/hooks/Grid/contextMenu/useGridContextMenu.pluginGroup.test.tsx`                         |
| `src/renderer/hooks/Grid/useGridContextMenu.test.tsx`                                           | `src/renderer/hooks/Grid/contextMenu/useGridContextMenu.test.tsx`                                     |
| `src/renderer/hooks/Grid/useGridContextMenu.ts`                                                 | `src/renderer/hooks/Grid/contextMenu/useGridContextMenu.ts`                                           |
| `src/renderer/hooks/Grid/useGridKeyboard.test.tsx`                                              | `src/renderer/hooks/Grid/selection/useGridKeyboard.test.tsx`                                          |
| `src/renderer/hooks/Grid/useGridKeyboard.ts`                                                    | `src/renderer/hooks/Grid/selection/useGridKeyboard.ts`                                                |
| `src/renderer/hooks/Grid/useGridMarquee.test.tsx`                                               | `src/renderer/hooks/Grid/selection/useGridMarquee.test.tsx`                                           |
| `src/renderer/hooks/Grid/useGridMarquee.ts`                                                     | `src/renderer/hooks/Grid/selection/useGridMarquee.ts`                                                 |
| `src/renderer/hooks/Grid/useGridResize.test.tsx`                                                | `src/renderer/hooks/Grid/resize/useGridResize.test.tsx`                                               |
| `src/renderer/hooks/Grid/useGridResize.ts`                                                      | `src/renderer/hooks/Grid/resize/useGridResize.ts`                                                     |
| `src/renderer/hooks/Grid/useGridSelection.arrowMixedMove.test.tsx`                              | `src/renderer/hooks/Grid/selection/useGridSelection.arrowMixedMove.test.tsx`                          |
| `src/renderer/hooks/Grid/useGridSelection.test.tsx`                                             | `src/renderer/hooks/Grid/selection/useGridSelection.test.tsx`                                         |
| `src/renderer/hooks/Grid/useGridSelection.ts`                                                   | `src/renderer/hooks/Grid/selection/useGridSelection.ts`                                               |
| `src/renderer/hooks/Grid/useGridZoomPan.test.tsx`                                               | `src/renderer/hooks/Grid/viewport/useGridZoomPan.test.tsx`                                            |
| `src/renderer/hooks/Grid/useGridZoomPan.ts`                                                     | `src/renderer/hooks/Grid/viewport/useGridZoomPan.ts`                                                  |
| `src/renderer/hooks/Grid/useHistoryShortcuts.test.tsx`                                          | `src/renderer/hooks/Grid/selection/useHistoryShortcuts.test.tsx`                                      |
| `src/renderer/hooks/Grid/useHistoryShortcuts.ts`                                                | `src/renderer/hooks/Grid/selection/useHistoryShortcuts.ts`                                            |
| `src/renderer/hooks/Grid/useSelectedElementDragLifecycle.test.tsx`                              | `src/renderer/hooks/Grid/drag/useSelectedElementDragLifecycle.test.tsx`                               |
| `src/renderer/hooks/Grid/useSelectedElementDragLifecycle.ts`                                    | `src/renderer/hooks/Grid/drag/useSelectedElementDragLifecycle.ts`                                     |
| `src/renderer/hooks/Grid/useSelectionDrag.test.tsx`                                             | `src/renderer/hooks/Grid/drag/useSelectionDrag.test.tsx`                                              |
| `src/renderer/hooks/Grid/useSelectionDrag.ts`                                                   | `src/renderer/hooks/Grid/drag/useSelectionDrag.ts`                                                    |
| `src/renderer/hooks/Grid/useSmartGuidesElements.ts`                                             | `src/renderer/hooks/Grid/drag/useSmartGuidesElements.ts`                                              |
| `src/renderer/utils/core/KeyMaps.ts`                                                            | `src/renderer/utils/input/KeyMaps.ts`                                                                 |
| `src/renderer/utils/core/arithmeticExpression.test.ts`                                          | `src/renderer/utils/number/arithmeticExpression.test.ts`                                              |
| `src/renderer/utils/core/arithmeticExpression.ts`                                               | `src/renderer/utils/number/arithmeticExpression.ts`                                                   |
| `src/renderer/utils/core/assetProbe.test.ts`                                                    | `src/renderer/utils/media/assetProbe.test.ts`                                                         |
| `src/renderer/utils/core/assetProbe.ts`                                                         | `src/renderer/utils/media/assetProbe.ts`                                                              |
| `src/renderer/utils/core/axisEventBus.ts`                                                       | `src/renderer/utils/input/axisEventBus.ts`                                                            |
| `src/renderer/utils/core/counterAnimationPreview.ts`                                            | `src/renderer/utils/counter/counterAnimationPreview.ts`                                               |
| `src/renderer/utils/core/counterGlyphMetrics.test.ts`                                           | `src/renderer/utils/counter/counterGlyphMetrics.test.ts`                                              |
| `src/renderer/utils/core/counterGlyphMetrics.ts`                                                | `src/renderer/utils/counter/counterGlyphMetrics.ts`                                                   |
| `src/renderer/utils/core/counterStyles.ts`                                                      | `src/renderer/utils/counter/counterStyles.ts`                                                         |
| `src/renderer/utils/core/dragCursor.ts`                                                         | `src/renderer/utils/dom/dragCursor.ts`                                                                |
| `src/renderer/utils/core/elementBorder.test.ts`                                                 | `src/renderer/utils/element/elementBorder.test.ts`                                                    |
| `src/renderer/utils/core/elementBorder.ts`                                                      | `src/renderer/utils/element/elementBorder.ts`                                                         |
| `src/renderer/utils/core/elementDefaults.ts`                                                    | `src/renderer/utils/element/elementDefaults.ts`                                                       |
| `src/renderer/utils/core/fontWeights.test.ts`                                                   | `src/renderer/utils/typography/fontWeights.test.ts`                                                   |
| `src/renderer/utils/core/fontWeights.ts`                                                        | `src/renderer/utils/typography/fontWeights.ts`                                                        |
| `src/renderer/utils/core/gridAnchorBounds.ts`                                                   | `src/renderer/utils/grid/gridAnchorBounds.ts`                                                         |
| `src/renderer/utils/core/gridViewportStyles.test.ts`                                            | `src/renderer/utils/grid/gridViewportStyles.test.ts`                                                  |
| `src/renderer/utils/core/gridViewportStyles.ts`                                                 | `src/renderer/utils/grid/gridViewportStyles.ts`                                                       |
| `src/renderer/utils/core/imageSource.test.ts`                                                   | `src/renderer/utils/media/imageSource.test.ts`                                                        |
| `src/renderer/utils/core/imageSource.ts`                                                        | `src/renderer/utils/media/imageSource.ts`                                                             |
| `src/renderer/utils/core/imageWarmup.test.ts`                                                   | `src/renderer/utils/media/imageWarmup.test.ts`                                                        |
| `src/renderer/utils/core/imageWarmup.ts`                                                        | `src/renderer/utils/media/imageWarmup.ts`                                                             |
| `src/renderer/utils/core/keyEventBus.ts`                                                        | `src/renderer/utils/input/keyEventBus.ts`                                                             |
| `src/renderer/utils/core/mixedValue.test.ts`                                                    | `src/renderer/components/main/Grid/PropertiesPanel/batch/mixedValue.test.ts`                          |
| `src/renderer/utils/core/mixedValue.ts`                                                         | `src/renderer/components/main/Grid/PropertiesPanel/batch/mixedValue.ts`                               |
| `src/renderer/utils/core/noteLengthPolicy.ts`                                                   | `src/renderer/utils/noteLengthPolicy.ts`                                                              |
| `src/renderer/utils/core/numberStep.ts`                                                         | `src/renderer/utils/number/numberStep.ts`                                                             |
| `src/renderer/utils/core/pathDisplay.ts`                                                        | `src/renderer/utils/media/pathDisplay.ts`                                                             |
| `src/renderer/utils/core/rawKeyEventBus.ts`                                                     | `src/renderer/utils/input/rawKeyEventBus.ts`                                                          |
| `src/renderer/utils/core/stableHandlerSlots.test.ts`                                            | `src/renderer/utils/ui/stableHandlerSlots.test.ts`                                                    |
| `src/renderer/utils/core/stableHandlerSlots.ts`                                                 | `src/renderer/utils/ui/stableHandlerSlots.ts`                                                         |
| `src/renderer/utils/core/templateEngine.ts`                                                     | `src/renderer/utils/plugin/components/templateEngine.ts`                                              |
| `src/renderer/utils/core/typography.ts`                                                         | `src/renderer/utils/typography/typography.ts`                                                         |
| `src/renderer/utils/core/zIndexFallback.test.ts`                                                | `src/renderer/utils/element/zIndexFallback.test.ts`                                                   |
| `src/renderer/utils/core/zIndexFallback.ts`                                                     | `src/renderer/utils/element/zIndexFallback.ts`                                                        |
| `src/renderer/utils/plugin/pluginComponents.ts`                                                 | `src/renderer/utils/plugin/components/pluginComponents.ts`                                            |
| `src/renderer/utils/plugin/pluginDialogInteractions.test.ts`                                    | `src/renderer/utils/plugin/interactions/pluginDialogInteractions.test.ts`                             |
| `src/renderer/utils/plugin/pluginDialogInteractions.ts`                                         | `src/renderer/utils/plugin/interactions/pluginDialogInteractions.ts`                                  |
| `src/renderer/utils/plugin/pluginDomInteractions.test.ts`                                       | `src/renderer/utils/plugin/interactions/pluginDomInteractions.test.ts`                                |
| `src/renderer/utils/plugin/pluginDomInteractions.ts`                                            | `src/renderer/utils/plugin/interactions/pluginDomInteractions.ts`                                     |
| `src/renderer/utils/plugin/pluginDropdownManager.test.ts`                                       | `src/renderer/utils/plugin/interactions/pluginDropdownManager.test.ts`                                |
| `src/renderer/utils/plugin/pluginDropdownManager.ts`                                            | `src/renderer/utils/plugin/interactions/pluginDropdownManager.ts`                                     |
| `src/renderer/utils/plugin/pluginElementContextMenu.test.ts`                                    | `src/renderer/utils/plugin/menu/pluginElementContextMenu.test.ts`                                     |
| `src/renderer/utils/plugin/pluginElementContextMenu.ts`                                         | `src/renderer/utils/plugin/menu/pluginElementContextMenu.ts`                                          |
| `src/renderer/utils/plugin/pluginElementLayout.test.ts`                                         | `src/renderer/utils/plugin/layout/pluginElementLayout.test.ts`                                        |
| `src/renderer/utils/plugin/pluginElementLayout.ts`                                              | `src/renderer/utils/plugin/layout/pluginElementLayout.ts`                                             |
| `src/renderer/utils/plugin/pluginElementMeasurement.test.ts`                                    | `src/renderer/utils/plugin/layout/pluginElementMeasurement.test.ts`                                   |
| `src/renderer/utils/plugin/pluginElementMeasurement.ts`                                         | `src/renderer/utils/plugin/layout/pluginElementMeasurement.ts`                                        |
| `src/renderer/utils/plugin/pluginHandlerDispatcher.test.ts`                                     | `src/renderer/utils/plugin/interactions/pluginHandlerDispatcher.test.ts`                              |
| `src/renderer/utils/plugin/pluginHandlerDispatcher.ts`                                          | `src/renderer/utils/plugin/interactions/pluginHandlerDispatcher.ts`                                   |
| `src/renderer/utils/plugin/pluginLayoutElements.test.ts`                                        | `src/renderer/utils/plugin/layout/pluginLayoutElements.test.ts`                                       |
| `src/renderer/utils/plugin/pluginLayoutElements.ts`                                             | `src/renderer/utils/plugin/layout/pluginLayoutElements.ts`                                            |
| `src/renderer/utils/plugin/pluginMenuRuntimeState.test.ts`                                      | `src/renderer/utils/plugin/menu/pluginMenuRuntimeState.test.ts`                                       |
| `src/renderer/utils/plugin/pluginMenuRuntimeState.ts`                                           | `src/renderer/utils/plugin/menu/pluginMenuRuntimeState.ts`                                            |
| `src/renderer/utils/plugin/pluginRenderList.ts`                                                 | `src/renderer/utils/plugin/layout/pluginRenderList.ts`                                                |
| `src/renderer/utils/plugin/pluginUtils.test.ts`                                                 | `src/renderer/utils/plugin/components/pluginUtils.test.ts`                                            |
| `src/renderer/utils/plugin/pluginUtils.ts`                                                      | `src/renderer/utils/plugin/components/pluginUtils.ts`                                                 |
