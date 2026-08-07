# 인터랙션 성능 개선 추적표

> 작성일: 2026-08-07
>
> 상태: 그림자 토글 파일럿 자동 측정·WebView 검증 중
>
> 원칙: 실측값만 기록하며 추정값이나 임의의 성능 수치를 입력하지 않는다.
>
> 관련 문서: [인터랙션 최적화 전수 인벤토리](./interaction-optimization-inventory.md) · [인터랙션 반응성 개선 설계](./interaction-responsiveness-design.md)

---

## 1. 사용 방법

1. 측정 환경을 먼저 고정하고 아래 `측정 세션`에 기록한다.
2. 최적화 전 같은 시나리오를 반복해 기준선 P50·P95를 기록한다.
3. 최적화 구현과 커밋 또는 PR을 연결한다.
4. 같은 환경과 입력 데이터로 개선 후 값을 측정한다.
5. 개선율과 정확성 게이트를 확인한 뒤 상태를 `완료`로 바꾼다.

### 상태 값

| 상태   | 의미                                    |
| ------ | --------------------------------------- |
| 대기   | 아직 측정하지 않음                      |
| 기준선 | 최적화 전 기준선 측정 완료              |
| 실험   | 구현 또는 비교 실험 진행 중             |
| 검증   | 개선 후 성능·정확성 검증 중             |
| 완료   | 성능 목표와 정확성 게이트 통과          |
| 보류   | 효과가 작거나 다른 작업이 선행되어야 함 |
| 회귀   | 개선 후 값 또는 정확성이 악화됨         |

## 2. 측정 지표

| 코드   | 지표                      | 단위     | 측정 시작               | 측정 종료                     | 주 적용 대상                 |
| ------ | ------------------------- | -------- | ----------------------- | ----------------------------- | ---------------------------- |
| CTP    | Click-to-paint            | ms       | pointer/key 입력 시각   | 상태 변화가 처음 paint된 시각 | 버튼, 토글, 탭, 메뉴         |
| ETC    | End-to-complete           | ms       | 사용자 입력 시각        | 저장·IPC·렌더 정합성 완료     | 비동기 버튼, 설정, 파일 작업 |
| F95    | 연속 입력 프레임 시간 P95 | ms/frame | 드래그·휠·슬라이더 시작 | 제스처 종료                   | 드래그, 줌, 리사이즈, 색상   |
| DROP   | 긴 프레임 비율            | %        | 연속 입력 시작          | 제스처 종료                   | 모든 P0 연속 입력            |
| RENDER | 입력당 React commit 수    | count    | 입력 시작               | 최종 상태 반영                | Store·패널·캔버스 변경       |
| LONG   | 50ms 이상 Long Task       | count    | 시나리오 시작           | 시나리오 종료                 | 메인 스레드 병목 진단        |

주 지표는 항목의 체감 병목을 대표하는 값이다. 필요하면 `측정 세션`의 비고나 별도 원시 로그에 보조 지표를 함께 남긴다.

### 개선율

낮을수록 좋은 시간 지표의 개선율:

```text
개선율(%) = (기준선 P95 - 개선 후 P95) / 기준선 P95 × 100
```

- 양수: 개선
- 0% 부근: 유의미한 변화 없음
- 음수: 회귀
- 기준선이 없거나 0이면 계산하지 않음

## 3. 고정 측정 조건

측정 세션마다 바뀐 값만 다시 기록한다.

| 조건                   | 기준값                                       |
| ---------------------- | -------------------------------------------- |
| OS·버전                | —                                            |
| CPU·메모리             | —                                            |
| 디스플레이 주사율·배율 | —                                            |
| DmNote 빌드·커밋       | —                                            |
| 개발·프로덕션 빌드     | 프로덕션 빌드 권장                           |
| 창 크기·오버레이 상태  | —                                            |
| 테스트 탭·키 개수      | —                                            |
| 선택 요소 수           | 단일, 10개, 100개 등 시나리오별 고정         |
| 플러그인·CSS·JS 상태   | —                                            |
| 측정 도구·버전         | —                                            |
| 워밍업 횟수            | —                                            |
| 기록 반복 횟수         | 최소값을 정한 뒤 모든 비교에서 동일하게 유지 |

## 4. 핵심 현황

수치는 실제 측정이 시작되면 갱신한다.

| 지표                             | 현재 값 |
| -------------------------------- | ------- |
| 전체 추적 항목                   | 165개   |
| 대기                             | 88개    |
| 완료                             | 0개     |
| 실험·검증 중                     | 77개    |
| 회귀                             | 0개     |
| P0 완료율                        | —       |
| 측정 완료 항목의 P95 중앙 개선율 | —       |
| 가장 큰 개선                     | —       |
| 가장 큰 회귀                     | —       |

## 5. 전수 성능 추적표

모든 성능 값은 주 지표의 P95이며 단위는 `주 지표` 열을 따른다. 더 자세한 P50·P95·보조 지표는 `측정 세션`에 기록한다.

<!-- PILOT-01:RESULT:START -->

#### PILOT-01 최신 자동 측정

| 조건           | 값                                                                    |
| -------------- | --------------------------------------------------------------------- |
| 측정 경로      | 실제 `updateKeyStyle` + 요소 그림자 CSS 렌더의 jsdom DOM commit proxy |
| 요소 수        | 500개                                                                 |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회                                |
| 측정 코드 커밋 | `123e5878915d0809ab416b59774fa86fa17901be`                            |
| 비교 전략      | `sync` → `after-paint`                                                |
| 환경           | darwin arm64, v25.2.1                                                 |

| P95 지표              | sync 기준선 | after-paint | 개선율 |
| --------------------- | ----------: | ----------: | -----: |
| 시각 DOM commit       |     5.946ms |     0.509ms |  91.4% |
| canonical DOM commit  |     5.947ms |     8.847ms | -48.8% |
| React commit duration |     0.723ms |     0.971ms | -34.3% |

- 원시 결과: [기준선](../benchmarks/results/pilot-01-baseline.json) · [개선](../benchmarks/results/pilot-01-improved.json)
- 정확성 게이트: `npm run test:interaction:pilot` 통과
- 실제 WebView click-to-paint 값은 브라우저 또는 Tauri 자동화 표면에서 별도 검증 전까지 기록하지 않는다.
<!-- PILOT-01:RESULT:END -->

#### PILOT-01 Chromium 실제 렌더 경로 검증

커밋 `809f8fe1`, Google Chrome 151.0.7922.77, 500개 요소, 40회 반복과 5회 워밍업 조건이다. 새 Vite 프로세스에서 두 전략을 같은 순서로 실행했으며 Computer Use가 완료 후 창 제목에 노출된 P95를 수집했다.

| P95 지표              | sync 기준선 | after-paint |  변화율 |
| --------------------- | ----------: | ----------: | ------: |
| 시각 DOM commit       |    11.300ms |     3.100ms |   72.6% |
| canonical DOM commit  |    11.300ms |    27.400ms | -142.5% |
| paint opportunity     |    34.100ms |    34.200ms |   -0.3% |
| React commit duration |     2.300ms |     2.900ms |  -26.1% |

- 원시 결과: [Chromium P95](../benchmarks/results/pilot-01-chromium-p95.json)
- 해석: 시각 DOM 반영은 빨라졌고 paint opportunity는 같은 프레임 구간을 유지했다. canonical commit 증가는 첫 paint 뒤로 작업을 옮긴 의도된 교환관계다.
- 제한: macOS WKWebView와 Windows WebView2 실측은 아직 완료되지 않았다.

<!-- PILOT-02:RESULT:START -->

#### PILOT-02 최신 자동 측정

| 조건              | 값                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- |
| 측정 경로         | 전체 선택 요소 shadow 쌍 배치 변환 + 요소 그림자 CSS 렌더의 jsdom DOM commit proxy |
| 선택·렌더 요소 수 | 500개                                                                              |
| 반복              | 기준선 30회 / 개선 30회, 워밍업 각 5회                                             |
| 측정 코드 커밋    | `123e5878915d0809ab416b59774fa86fa17901be`                                         |
| 비교 전략         | `sync` → `after-paint`                                                             |
| 환경              | darwin arm64, v25.2.1                                                              |

| P95 지표              | sync 기준선 | after-paint | 개선율 |
| --------------------- | ----------: | ----------: | -----: |
| 시각 DOM commit       |     8.385ms |     0.550ms |  93.4% |
| canonical DOM commit  |     8.387ms |    10.648ms | -27.0% |
| React commit duration |     0.810ms |     1.009ms | -24.7% |

- 원시 결과: [기준선](../benchmarks/results/pilot-02-baseline.json) · [개선](../benchmarks/results/pilot-02-improved.json)
- 정확성 게이트: `npm run test:interaction:pilot` 통과
- 공통 `ShadowControls`의 시각 우선 반영이 배치 canonical 변환 비용과 분리되는지 검증한다.
<!-- PILOT-02:RESULT:END -->

<!-- BASE-07:RESULT:START -->

#### BASE-07 TabSwitch 최신 자동 측정

| 조건           | 값                                              |
| -------------- | ----------------------------------------------- |
| 측정 경로      | 공통 TabSwitch + 탭 콘텐츠 DOM 500개 교체 proxy |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회          |
| 측정 코드 커밋 | `84917c5a11b1439e9ed8c049446f5eda699d2850`      |
| 비교 전략      | `sync` → `after-paint`                          |
| 환경           | darwin arm64, v25.2.1                           |

| P95 지표                | sync 기준선 | after-paint | 개선율 |
| ----------------------- | ----------: | ----------: | -----: |
| 활성 탭 DOM commit      |    10.851ms |     0.492ms |  95.5% |
| canonical 콘텐츠 commit |    10.852ms |    15.393ms | -41.8% |
| React commit duration   |     0.838ms |     1.241ms | -48.1% |

- 원시 결과: [기준선](../benchmarks/results/base-07-tab-switch-baseline.json) · [개선](../benchmarks/results/base-07-tab-switch-improved.json)
- 정확성 게이트: `TabSwitch.test.tsx` 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-07:RESULT:END -->

<!-- BASE-03:RESULT:START -->

#### BASE-03 Dropdown 최신 자동 측정

| 조건           | 값                                               |
| -------------- | ------------------------------------------------ |
| 측정 경로      | 공통 Dropdown + 선택 콘텐츠 DOM 500개 교체 proxy |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회           |
| 구현 코드 커밋 | `2b9b6cf4ebe4efeeaaa84530915103dd9921bdaa`       |
| 측정 코드 커밋 | `138ce232a2d89c320da3656308825752aa97f97e`       |
| 비교 전략      | `sync` → `after-paint`                           |
| 환경           | darwin arm64, v25.2.1                            |

| P95 지표              | sync 기준선 | after-paint | 개선율 |
| --------------------- | ----------: | ----------: | -----: |
| 메뉴 닫힘 DOM commit  |    10.981ms |     0.336ms |  96.9% |
| canonical 선택 commit |    10.983ms |    14.247ms | -29.7% |
| React commit duration |     0.902ms |     0.984ms |  -9.0% |

- 원시 결과: [기준선](../benchmarks/results/base-03-dropdown-baseline.json) · [개선](../benchmarks/results/base-03-dropdown-improved.json)
- 정확성 게이트: `Dropdown.test.tsx` 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-03:RESULT:END -->

<!-- BASE-04:RESULT:START -->

#### BASE-04 NumberInput 최신 자동 측정

| 조건           | 값                                                  |
| -------------- | --------------------------------------------------- |
| 측정 경로      | 공통 NumberInput + 부모 콘텐츠 DOM 500개 교체 proxy |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회              |
| 구현 코드 커밋 | `1b8945cf75d5097afad83ba4d65eea3f7dc505c3`          |
| 측정 코드 커밋 | `25de3261a5a0465ec5f43c3a03932b9b54cf9ee3`          |
| 비교 전략      | `sync` → `after-paint`                              |
| 환경           | darwin arm64, v25.2.1                               |

| P95 지표              | sync 기준선 | after-paint | 개선율 |
| --------------------- | ----------: | ----------: | -----: |
| input echo DOM commit |    12.316ms |     0.323ms |  97.4% |
| canonical 값 commit   |    12.317ms |    15.134ms | -22.9% |
| React commit duration |     0.825ms |     0.977ms | -18.4% |

- 원시 결과: [기준선](../benchmarks/results/base-04-number-input-baseline.json) · [개선](../benchmarks/results/base-04-number-input-improved.json)
- 정확성 게이트: `PropertyInputs.test.tsx` 통과
- 실제 WebView 키 입력-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-04:RESULT:END -->

<!-- BASE-05:RESULT:START -->

#### BASE-05 TextInput·SearchField 최신 자동 측정

| 조건           | 값                                                |
| -------------- | ------------------------------------------------- |
| 측정 경로      | 공통 TextInput + 부모 콘텐츠 DOM 500개 교체 proxy |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회            |
| 구현 코드 커밋 | `8c66281b512a0e655826a33f2f6d8ae0f9af30ac`        |
| 측정 코드 커밋 | `02b6bd36d4d92e4a81183ca8bd4737b312d8911f`        |
| 비교 전략      | `sync` → `after-paint`                            |
| 환경           | darwin arm64, v25.2.1                             |

| P95 지표              | sync 기준선 | after-paint | 개선율 |
| --------------------- | ----------: | ----------: | -----: |
| input echo DOM commit |    14.968ms |     0.445ms |  97.0% |
| canonical 값 commit   |    14.970ms |    19.173ms | -28.1% |
| React commit duration |     1.233ms |     1.523ms | -23.5% |

- 원시 결과: [기준선](../benchmarks/results/base-05-text-input-baseline.json) · [개선](../benchmarks/results/base-05-text-input-improved.json)
- 정확성 게이트: `PropertyInputs.test.tsx`·`SearchField.test.tsx` 통과
- 실제 WebView 키 입력-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-05:RESULT:END -->

<!-- BASE-06:RESULT:START -->

#### BASE-06 ColorInput·ColorSwatchButton 최신 자동 측정

| 조건           | 값                                           |
| -------------- | -------------------------------------------- |
| 측정 경로      | 공통 ColorInput + 피커 DOM 500개 mount proxy |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회       |
| 구현 코드 커밋 | `cb3335bd6ca76cdcf9fc19521964a604a9b05c7f`   |
| 측정 코드 커밋 | `14d7427bff8ba75e40e27abf0cda8feaa72b39e7`   |
| 비교 전략      | `sync` → `after-paint`                       |
| 환경           | darwin arm64, v25.2.1                        |

| P95 지표               | sync 기준선 | after-paint | 개선율 |
| ---------------------- | ----------: | ----------: | -----: |
| 스와치 열림 DOM commit |    10.828ms |     0.268ms |  97.5% |
| 피커 mount DOM commit  |    10.898ms |    14.353ms | -31.7% |
| React commit duration  |     9.957ms |    10.759ms |  -8.0% |

- 원시 결과: [기준선](../benchmarks/results/base-06-color-input-baseline.json) · [개선](../benchmarks/results/base-06-color-input-improved.json)
- 정확성 게이트: ColorInput mount·상태 capability 테스트 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-06:RESULT:END -->

<!-- BASE-08:RESULT:START -->

#### BASE-08 ListPopup·FloatingPopup 최신 자동 측정

| 조건           | 값                                              |
| -------------- | ----------------------------------------------- |
| 측정 경로      | 공통 FloatingPopup + 메뉴 DOM 500개 mount proxy |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회          |
| 구현 코드 커밋 | `fd24b34569f1fd74b50df0a58fb31f495c75f06b`      |
| 측정 코드 커밋 | `264725fb8873a99b1ce8ba4d457404ef7df02866`      |
| 비교 전략      | `sync` → `after-paint`                          |
| 환경           | darwin arm64, v25.2.1                           |

| P95 지표                | sync 기준선 | after-paint | 개선율 |
| ----------------------- | ----------: | ----------: | -----: |
| opener·shell DOM commit |    23.983ms |    10.642ms |  55.6% |
| popup content mount     |    24.057ms |    21.149ms |  12.1% |
| React commit duration   |    11.017ms |     6.826ms |  38.0% |

- 원시 결과: [기준선](../benchmarks/results/base-08-floating-popup-baseline.json) · [개선](../benchmarks/results/base-08-floating-popup-improved.json)
- 정확성 게이트: FloatingPopup 포커스·계층 소유권과 ListPopup 키보드 계약 테스트 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-08:RESULT:END -->

<!-- BASE-09:RESULT:START -->

#### BASE-09 Modal 최신 자동 측정

| 조건           | 값                                         |
| -------------- | ------------------------------------------ |
| 측정 경로      | 공통 Modal + 본문 DOM 500개 mount proxy    |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회     |
| 구현 코드 커밋 | `9f9631c1ebc874a00d8e987ef180e120fcdaf7bf` |
| 측정 코드 커밋 | `a9598cdd9f34ed7d16443a7fb6920c5f47b82e07` |
| 비교 전략      | `sync` → `after-paint`                     |
| 환경           | darwin arm64, v25.2.1                      |

| P95 지표                       | sync 기준선 | after-paint | 개선율 |
| ------------------------------ | ----------: | ----------: | -----: |
| opener·dialog shell DOM commit |    13.454ms |     4.308ms |  68.0% |
| modal content mount            |    13.551ms |    14.451ms |  -6.6% |
| React commit duration          |     7.518ms |     6.289ms |  16.3% |

- 원시 결과: [기준선](../benchmarks/results/base-09-modal-baseline.json) · [개선](../benchmarks/results/base-09-modal-improved.json)
- 정확성 게이트: Modal 포커스·복원·키보드·중첩 popup 계약 테스트 통과
- 실제 WebView click-to-paint 값은 macOS WKWebView·Windows WebView2에서 별도 검증한다.
<!-- BASE-09:RESULT:END -->

<!-- GRID-05:RESULT:START -->

#### GRID-05 미들 버튼 팬 연속 입력 최신 자동 측정

| 조건           | 값                                                         |
| -------------- | ---------------------------------------------------------- |
| 측정 경로      | 실제 useGridZoomPan + 렌더 DOM 500개, mousemove 20회 burst |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회                     |
| 구현 코드 커밋 | `9c90cae8fe9bbcc1f23a7e3b3ae47b07c86ac171`                 |
| 측정 코드 커밋 | `19f6590331c308cde9759ea56694a304c2a40b72`                 |
| 비교 전략      | `legacy` → `frame`                                         |
| 환경           | darwin arm64, v25.2.1                                      |

| P95 지표              |   legacy | frame coalescing | 개선율 |
| --------------------- | -------: | ---------------: | -----: |
| burst event blocking  |  0.306ms |          0.225ms |  26.3% |
| 최종 DOM commit       | 11.655ms |         11.384ms |   2.3% |
| React commit duration |  1.362ms |          1.067ms |  21.7% |

- 원시 결과: [기준선](../benchmarks/results/grid-05-middle-pan-baseline.json) · [개선](../benchmarks/results/grid-05-middle-pan-improved.json)
- 정확성 게이트: wheel delta 누적·미들 팬 최신 좌표·드래그 프레임 병합 테스트 통과
<!-- GRID-05:RESULT:END -->

<!-- GRID-09:RESULT:START -->

#### GRID-09 마퀴 선택 최신 자동 측정

| 조건           | 값                                                         |
| -------------- | ---------------------------------------------------------- |
| 측정 경로      | 실제 useGridMarquee + 렌더 DOM 500개, mousemove 20회 burst |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회                     |
| 구현 코드 커밋 | `f96cdd5718ff93b2de2c43f7e4b3b931cab45388`                 |
| 측정 코드 커밋 | `a9d8d465c31005628237a164d62506b834b13b35`                 |
| 비교 전략      | `legacy` → `frame`                                         |
| 환경           | darwin arm64, v25.2.1                                      |

| P95 지표              |  legacy | frame coalescing | 개선율 |
| --------------------- | ------: | ---------------: | -----: |
| burst event blocking  | 0.261ms |          0.139ms |  47.0% |
| 최종 DOM commit       | 6.321ms |          5.033ms |  20.4% |
| React commit duration | 0.906ms |          0.932ms |  -2.8% |

- 원시 결과: [기준선](../benchmarks/results/grid-09-marquee-baseline.json) · [개선](../benchmarks/results/grid-09-marquee-improved.json)
- 정확성 게이트: 최신 좌표 병합·mouseup 최종 좌표 flush 테스트 통과
<!-- GRID-09:RESULT:END -->

<!-- GRID-06:RESULT:START -->

#### GRID-06 단일 리사이즈 최신 자동 측정

| 조건           | 값                                                        |
| -------------- | --------------------------------------------------------- |
| 측정 경로      | 실제 ResizeHandles + 렌더 DOM 500개, mousemove 20회 burst |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회                    |
| 구현 코드 커밋 | `78fb15eb36f007c3c691c8af51b2fc87a1bd1f77`                |
| 측정 코드 커밋 | `d092017a5ec3dd0b9a4a9fb9449465a24dd42742`                |
| 비교 전략      | `legacy` → `frame`                                        |
| 환경           | darwin arm64, v25.2.1                                     |

| P95 지표              |  legacy | frame coalescing | 개선율 |
| --------------------- | ------: | ---------------: | -----: |
| burst event blocking  | 0.155ms |          0.144ms |   7.2% |
| 최종 DOM commit       | 7.589ms |          8.699ms | -14.6% |
| React commit duration | 1.154ms |          1.390ms | -20.5% |

- 원시 결과: [기준선](../benchmarks/results/grid-06-resize-baseline.json) · [개선](../benchmarks/results/grid-06-resize-improved.json)
- 정확성 게이트: 최신 bounds 병합·mouseup flush·resize commit 테스트 통과
<!-- GRID-06:RESULT:END -->

<!-- GRID-08:RESULT:START -->

#### GRID-08 그라데이션 축 최신 자동 측정

| 조건           | 값                                                                         |
| -------------- | -------------------------------------------------------------------------- |
| 측정 경로      | 실제 GradientAxisOverlay + preview 구독 요소 500개, pointermove 20회 burst |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회                                     |
| 구현 코드 커밋 | `23582b9a48a3b0a0407f3acf5adfb00ba9af8b37`                                 |
| 측정 코드 커밋 | `50147d669855daf789d4a53ef5c391af990c91b3`                                 |
| 비교 전략      | `legacy` → `frame`                                                         |
| 환경           | darwin arm64, v25.2.1                                                      |

| P95 지표              |  legacy | frame coalescing | 개선율 |
| --------------------- | ------: | ---------------: | -----: |
| burst event blocking  | 0.405ms |          0.137ms |  66.2% |
| 최종 DOM commit       | 3.076ms |          4.391ms | -42.8% |
| React commit duration | 2.145ms |          2.220ms |  -3.5% |

- 원시 결과: [기준선](../benchmarks/results/grid-08-gradient-axis-baseline.json) · [개선](../benchmarks/results/grid-08-gradient-axis-improved.json)
- 정확성 게이트: 최신 좌표 병합·pointerup flush·세션 세대 격리 테스트 통과
<!-- GRID-08:RESULT:END -->

<!-- GRID-11:RESULT:START -->

#### GRID-11 미니맵 드래그 최신 자동 측정

| 조건           | 값                                                       |
| -------------- | -------------------------------------------------------- |
| 측정 경로      | 실제 GridMinimap + SVG 요소 500개, mousemove 100회 burst |
| 반복           | 기준선 30회 / 개선 30회, 워밍업 각 5회                   |
| 구현 코드 커밋 | `25a0c0a32a41acc5112c3c1e2f3176a7fdf28639`               |
| 측정 코드 커밋 | `1ca338796ad3431ff5b9b5877d6dd23a9f3ff397`               |
| 비교 전략      | `legacy` → `frame`                                       |
| 환경           | darwin arm64, v25.2.1                                    |

| P95 지표              |  legacy | frame coalescing | 개선율 |
| --------------------- | ------: | ---------------: | -----: |
| burst event blocking  | 0.711ms |          0.569ms |  19.9% |
| 최종 DOM commit       | 3.864ms |          4.783ms | -23.8% |
| React commit duration | 2.740ms |          2.503ms |   8.7% |

- 원시 결과: [기준선](../benchmarks/results/grid-11-minimap-baseline.json) · [개선](../benchmarks/results/grid-11-minimap-improved.json)
- 정확성 게이트: 최신 좌표 병합·mouseup flush·최종 pan 테스트 통과
<!-- GRID-11:RESULT:END -->

### 5.1 파일럿·공통 기반

| ID       | 항목                               | 우선순위 | 주 지표      | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거                                                                                                                                 |
| -------- | ---------------------------------- | -------- | ------------ | -------: | -------: | -----: | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| PILOT-01 | 단일 선택 그림자 사용 토글         | P1       | DOM P95 ms   |    5.946 |    0.509 |  91.4% | 검증 | [기준선](../benchmarks/results/pilot-01-baseline.json) · [개선](../benchmarks/results/pilot-01-improved.json)                             |
| PILOT-02 | 다중 선택 그림자 사용 토글         | P1       | DOM P95 ms   |    8.385 |    0.550 |  93.4% | 검증 | [기준선](../benchmarks/results/pilot-02-baseline.json) · [개선](../benchmarks/results/pilot-02-improved.json)                             |
| BASE-01  | 공통 Checkbox                      | 기반     | CTP ms       |        — |        — |      — | 실험 | `useOptimisticBooleanCommit`·선택적 `commitStrategy` 제공, PILOT-01·02 검증                                                               |
| BASE-02  | SettingToggleRow                   | 기반     | CTP ms       |        — |        — |      — | 실험 | `05c02e43`, 선택적 `after-paint`·설정 토글 적용                                                                                           |
| BASE-03  | Dropdown                           | 기반     | DOM P95 ms   |   10.981 |    0.336 |  96.9% | 검증 | [기준선](../benchmarks/results/base-03-dropdown-baseline.json) · [개선](../benchmarks/results/base-03-dropdown-improved.json)             |
| BASE-04  | NumberInput·OptionalNumberInput    | P0/P1    | DOM P95 ms   |   12.316 |    0.323 |  97.4% | 검증 | [기준선](../benchmarks/results/base-04-number-input-baseline.json) · [개선](../benchmarks/results/base-04-number-input-improved.json)     |
| BASE-05  | TextInput·SearchField              | P1       | DOM P95 ms   |   14.968 |    0.445 |  97.0% | 검증 | [기준선](../benchmarks/results/base-05-text-input-baseline.json) · [개선](../benchmarks/results/base-05-text-input-improved.json)         |
| BASE-06  | ColorInput·ColorSwatchButton       | P0/P1    | DOM P95 ms   |   10.828 |    0.268 |  97.5% | 검증 | [기준선](../benchmarks/results/base-06-color-input-baseline.json) · [개선](../benchmarks/results/base-06-color-input-improved.json)       |
| BASE-07  | TabSwitch                          | P3       | DOM P95 ms   |   10.851 |    0.492 |  95.5% | 검증 | [기준선](../benchmarks/results/base-07-tab-switch-baseline.json) · [개선](../benchmarks/results/base-07-tab-switch-improved.json)         |
| BASE-08  | ListPopup·FloatingPopup            | P1/P3    | DOM P95 ms   |   23.983 |   10.642 |  55.6% | 검증 | [기준선](../benchmarks/results/base-08-floating-popup-baseline.json) · [개선](../benchmarks/results/base-08-floating-popup-improved.json) |
| BASE-09  | Modal                              | 기반     | DOM P95 ms   |   13.454 |    4.308 |  68.0% | 검증 | [기준선](../benchmarks/results/base-09-modal-baseline.json) · [개선](../benchmarks/results/base-09-modal-improved.json)                   |
| BASE-10  | TooltipGroup                       | P3       | CTP ms       |        — |        — |      — | 대기 | 의도된 hover delay는 별도 기록                                                                                                            |
| BASE-11  | PanelToggleButton                  | P1       | CTP ms       |        — |        — |      — | 대기 | 패널 mount·render 포함                                                                                                                    |
| BASE-12  | 패널 내부 PickerSurface·내비게이션 | P1/P3    | CTP ms       |        — |        — |      — | 대기 | 위치 계산과 첫 paint                                                                                                                      |
| BASE-13  | 프로퍼티 패널 smooth scroll        | P0       | F95 ms/frame |        — |        — |      — | 대기 | Lenis RAF 6개 영향 측정                                                                                                                   |
| BASE-14  | IconSwap·EyeToggleIcon             | 기반     | CTP ms       |        — |        — |      — | 대기 | 180ms 모션과 상태 반영 분리                                                                                                               |
| BASE-15  | usePressAction·usePressGatedSwap   | 기반     | CTP ms       |        — |        — |      — | 대기 | pressed 피드백과 300ms gate                                                                                                               |

### 5.2 설정·Grid·프로퍼티 토글

| ID     | 항목                                       | 우선순위 | 주 지표 | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거                          |
| ------ | ------------------------------------------ | -------- | ------- | -------: | -------: | -----: | ---- | ---------------------------------- |
| TOG-01 | 오버레이 잠금                              | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, CTP·ETC 측정 대기      |
| TOG-02 | 항상 위                                    | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 재동기화 검증 대기     |
| TOG-03 | 전역 노트 효과                             | P1       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, WebView 측정 대기      |
| TOG-04 | 전역 키 카운터                             | P1       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, WebView 측정 대기      |
| TOG-05 | 트레이 모드                                | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, CTP·ETC 측정 대기      |
| TOG-06 | OBS 모드                                   | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 서비스 ETC 측정 대기   |
| TOG-07 | 자동 업데이트                              | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 저장 실패 검증 대기    |
| TOG-08 | 개발자 모드                                | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, DevTools ETC 측정 대기 |
| TOG-09 | 커스텀 CSS                                 | P1/P2    | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 스타일 CTP 측정 대기   |
| TOG-10 | 커스텀 JS                                  | P2       | CTP ms  |        — |        — |      — | 실험 | `05c02e43`, 런타임 ETC 측정 대기   |
| TOG-11 | Grid 미니맵 표시                           | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-12 | Grid 정렬 가이드                           | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, 드래그 F95 측정 대기   |
| TOG-13 | Grid 간격 가이드                           | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, 드래그 F95 측정 대기   |
| TOG-14 | Grid 크기 일치 가이드                      | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, 리사이즈 F95 측정 대기 |
| TOG-15 | 단일 인라인 스타일 우선                    | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-16 | 단일 키 사운드 사용                        | P1/P2    | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-17 | 단일 노트 효과                             | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-18 | 단일 Y축 자동 보정                         | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-19 | 단일 글로우                                | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-20 | 단일 카운터 사용                           | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-21 | 단일 카운터 애니메이션                     | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, WebView 측정 대기      |
| TOG-22 | 그래프 평균선                              | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-23 | 그래프 애니메이션                          | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-24 | 그래프 인라인 스타일                       | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-25 | 노브 방향 반전                             | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-26 | 노브 인라인 스타일                         | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, WebView 측정 대기      |
| TOG-27 | 배치 인라인 스타일·사운드                  | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, 선택 수별 측정 대기    |
| TOG-28 | 배치 노트 효과·Y 보정·글로우               | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, 선택 수별 측정 대기    |
| TOG-29 | 배치 카운터·애니메이션                     | P1       | CTP ms  |        — |        — |      — | 실험 | `07976df8`, 선택 수별 측정 대기    |
| TOG-30 | 배치 그래프·노브 토글                      | P1       | CTP ms  |        — |        — |      — | 실험 | `99e64f07`, 중복 표면 측정 대기    |
| TOG-31 | 탭 CSS 사용                                | P2       | CTP ms  |        — |        — |      — | 실험 | `c9c10ee7`, CTP·ETC 측정 대기      |
| TOG-32 | 이미지 투명화                              | P1       | CTP ms  |        — |        — |      — | 실험 | `e923a837`, 이미지 CTP 측정 대기   |
| TOG-33 | 설정 모달의 카운터·노트 토글               | P1/P3    | CTP ms  |        — |        — |      — | 실험 | `e923a837`, preview 측정 대기      |
| TOG-34 | 플러그인 boolean 설정                      | P1/P2    | CTP ms  |        — |        — |      — | 실험 | `e923a837`, 저장 병합 검증 대기    |
| TOG-35 | 업데이트 버전 건너뛰기                     | P2       | CTP ms  |        — |        — |      — | 대기 | 저장 상태                          |
| TOG-36 | Display Element·커스텀 다이얼로그 체크박스 | P1/P2    | CTP ms  |        — |        — |      — | 대기 | React 공통 토글과 별도 경로        |

### 5.3 Grid·레이어 연속 입력과 편집 액션

| ID       | 항목                  | 우선순위 | 주 지표      | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거                                           |
| -------- | --------------------- | -------- | ------------ | -------: | -------: | -----: | ---- | --------------------------------------------------- |
| GRID-01  | 단일 요소 드래그      | P0       | F95 ms/frame |        — |        — |      — | 대기 | 가이드 on/off 별도                                  |
| GRID-02  | 다중 선택 드래그      | P0       | F95 ms/frame |        — |        — |      — | 대기 | 선택 수별 측정                                      |
| GRID-03  | Grid 패닝             | P0       | F95 ms/frame |        — |        — |      — | 실험 | `9c90cae8`, frame coalescing 적용                   |
| GRID-04  | 휠·핀치 줌            | P0       | F95 ms/frame |        — |        — |      — | 실험 | `9c90cae8`, frame coalescing 적용                   |
| GRID-05  | 미들 버튼 팬          | P0       | F95 ms/frame |    0.306 |    0.225 |  26.3% | 검증 | `9c90cae8`, frame coalescing 적용                   |
| GRID-06  | 단일 리사이즈         | P0       | F95 ms/frame |    0.155 |    0.144 |   7.2% | 검증 | `78fb15eb`, latest bounds frame coalescing          |
| GRID-07  | 그룹 리사이즈         | P0       | F95 ms/frame |        — |        — |      — | 실험 | `78fb15eb`, 공통 scheduler 적용·선택 수별 측정 대기 |
| GRID-08  | 그라데이션 축 핸들    | P0       | F95 ms/frame |    0.405 |    0.137 |  66.2% | 검증 | `23582b9a`, latest pointer frame coalescing         |
| GRID-09  | 마퀴 선택             | P0/P1    | F95 ms/frame |    0.261 |    0.139 |  47.0% | 검증 | `f96cdd57`, 최신 좌표 frame coalescing              |
| GRID-10  | 미니맵 클릭 이동      | P1       | CTP ms       |        — |        — |      — | 대기 | viewport 반영                                       |
| GRID-11  | 미니맵 드래그         | P0       | F95 ms/frame |    0.711 |    0.569 |  19.9% | 검증 | `25a0c0a3`, latest mouse frame coalescing           |
| GRID-12  | 요소 단일·다중 선택   | P1       | CTP ms       |        — |        — |      — | 대기 | 패널 교체 포함                                      |
| GRID-13  | Shift 범위 선택       | P1       | CTP ms       |        — |        — |      — | 대기 | 요소 수별 측정                                      |
| GRID-14  | 더블클릭 편집         | P1/P3    | CTP ms       |        — |        — |      — | 실험 | `9f9631c1`, 공통 dialog shell 우선 표시 적용        |
| GRID-15  | Grid 컨텍스트 메뉴    | P3       | CTP ms       |        — |        — |      — | 실험 | `fd24b345`, 공통 popup shell 우선 표시 적용         |
| GRID-16  | 요소 추가             | P1       | CTP ms       |        — |        — |      — | 대기 | 문서 commit ETC                                     |
| GRID-17  | 삭제·지우개           | P1       | CTP ms       |        — |        — |      — | 대기 | 문서 commit ETC                                     |
| GRID-18  | 복제·복사·붙여넣기    | P1       | CTP ms       |        — |        — |      — | 대기 | 다중 요소 시나리오                                  |
| GRID-19  | z-order 이동          | P1       | CTP ms       |        — |        — |      — | 대기 | 배열·zIndex 갱신                                    |
| GRID-20  | 그룹화·그룹 해제      | P1       | CTP ms       |        — |        — |      — | 대기 | 관계·문서 변경                                      |
| GRID-21  | 방향키 이동           | P0       | F95 ms/frame |        — |        — |      — | 대기 | 500ms gesture 병합                                  |
| GRID-22  | Undo·Redo             | P1       | CTP ms       |        — |        — |      — | 대기 | 문서·Store 동기화                                   |
| GRID-23  | 키 카운터 초기화      | P2       | ETC ms       |        — |        — |      — | 대기 | IPC 완료                                            |
| LAYER-01 | 레이어·Grid 탭 전환   | P3       | CTP ms       |        — |        — |      — | 대기 | 콘텐츠 paint                                        |
| LAYER-02 | 레이어 단일·다중 선택 | P1       | CTP ms       |        — |        — |      — | 대기 | 캔버스 동기화                                       |
| LAYER-03 | 그룹 접기·펼치기      | P3       | CTP ms       |        — |        — |      — | 대기 | 목록 reflow                                         |
| LAYER-04 | 이름 변경             | P1/P2    | CTP ms       |        — |        — |      — | 대기 | blur commit ETC                                     |
| LAYER-05 | 표시·숨김             | P1       | CTP ms       |        — |        — |      — | 대기 | 캔버스 paint                                        |
| LAYER-06 | 잠금·잠금 해제        | P1       | CTP ms       |        — |        — |      — | 대기 | 캔버스 상태                                         |
| LAYER-07 | 위·아래 이동          | P1       | CTP ms       |        — |        — |      — | 대기 | 목록·캔버스 순서                                    |
| LAYER-08 | 드래그 순서 변경      | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | local preview                                       |
| LAYER-09 | 그룹 드래그·중첩      | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | hit-test                                            |
| LAYER-10 | 레이어 컨텍스트 메뉴  | P3       | CTP ms       |        — |        — |      — | 실험 | `fd24b345`, 공통 popup shell 우선 표시 적용         |
| LAYER-11 | 패널 detach·reattach  | P2       | ETC ms       |        — |        — |      — | 대기 | 창 handoff                                          |
| LAYER-12 | 분리 패널 창 이동     | P0       | F95 ms/frame |        — |        — |      — | 대기 | 네이티브 drag                                       |

### 5.4 프로퍼티 입력·편집기·피커

| ID      | 항목                             | 우선순위 | 주 지표      | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거                                                |
| ------- | -------------------------------- | -------- | ------------ | -------: | -------: | -----: | ---- | -------------------------------------------------------- |
| PROP-01 | 숫자 입력                        | P0/P1    | CTP ms       |        — |        — |      — | 실험 | `1b8945cf`, 공통 숫자 입력 62곳 적용                     |
| PROP-02 | 텍스트 입력                      | P1       | CTP ms       |        — |        — |      — | 실험 | `8c66281b`, 공통 TextInput 8곳 적용                      |
| PROP-03 | 색상 입력                        | P0       | F95 ms/frame |        — |        — |      — | 실험 | `ad22c019` 상태 탭·`cb3335bd` 피커 mount 분리 적용       |
| PROP-04 | 그라데이션 입력                  | P0       | F95 ms/frame |        — |        — |      — | 실험 | `ad22c019`, 형식 탭 전환만 적용                          |
| PROP-05 | 드롭다운 속성 변경               | P1       | CTP ms       |        — |        — |      — | 실험 | `2b9b6cf4`, 로컬 선택 after-paint 적용                   |
| PROP-06 | 폰트 스타일 버튼                 | P1       | CTP ms       |        — |        — |      — | 대기 | batch 포함                                               |
| PROP-07 | 키 매핑·실입력 캡처              | P1/P2    | CTP ms       |        — |        — |      — | 실험 | `ad22c019`, 판정 탭 전환만 적용                          |
| PROP-08 | 이미지 설정                      | P1/P2    | CTP ms       |        — |        — |      — | 대기 | decode ETC                                               |
| PROP-09 | 사운드 설정                      | P1/P2    | CTP ms       |        — |        — |      — | 대기 | 파일·오디오 ETC                                          |
| PROP-10 | 단일·다중 선택 탭 전환           | P1       | CTP ms       |        — |        — |      — | 대기 | keepalive 범위                                           |
| PROP-11 | 플러그인 설정 color              | P0/P1    | F95 ms/frame |        — |        — |      — | 실험 | `cb3335bd`, 공통 ColorInput 피커 mount 분리 적용         |
| PROP-12 | 플러그인 설정 number·text·select | P1       | CTP ms       |        — |        — |      — | 실험 | `2b9b6cf4` select·`1b8945cf` number·`8c66281b` text 적용 |
| PROP-13 | 플러그인 설정 전체 저장          | P2       | ETC ms       |        — |        — |      — | 대기 | single-flight                                            |
| EDIT-01 | 색상 saturation·hue·alpha 드래그 | P0       | F95 ms/frame |        — |        — |      — | 대기 | picker 전체                                              |
| EDIT-02 | 색상 텍스트·퍼센트 입력          | P1       | CTP ms       |        — |        — |      — | 대기 | validation                                               |
| EDIT-03 | 그라데이션 stop 편집·형식 전환   | P0       | F95 ms/frame |    0.405 |    0.137 |  66.2% | 검증 | `23582b9a`, stop 드래그 병합·형식 탭 즉시 반영           |
| EDIT-04 | 카운터 bezier point 드래그       | P0       | F95 ms/frame |        — |        — |      — | 대기 | animation editor                                         |
| EDIT-05 | 카운터 미리보기 scrub·wheel·play | P0       | F95 ms/frame |        — |        — |      — | 대기 | precompute                                               |
| EDIT-06 | 사운드 파형 pan·zoom·trim        | P0       | F95 ms/frame |        — |        — |      — | 대기 | Worker 후보                                              |
| EDIT-07 | 사운드 재생·정지·seek            | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | media event coalescing                                   |
| EDIT-08 | 사운드 처리 저장                 | P2       | ETC ms       |        — |        — |      — | 대기 | progress·취소                                            |
| PICK-01 | 사운드 선택·검색·필터            | P1       | CTP ms       |        — |        — |      — | 실험 | `2b9b6cf4` 필터 Dropdown·`8c66281b` 검색 적용            |
| PICK-02 | 사운드 추가·삭제·이름·숨김       | P2       | ETC ms       |        — |        — |      — | 대기 | 파일 작업                                                |
| PICK-03 | 폰트 선택·검색·필터              | P1       | CTP ms       |        — |        — |      — | 실험 | `2b9b6cf4` 필터 Dropdown·`8c66281b` 검색 적용            |
| PICK-04 | 폰트 추가·삭제·이름 변경         | P2       | ETC ms       |        — |        — |      — | 대기 | 파일·검증                                                |
| PICK-05 | 카운터 애니메이션 선택·삭제      | P2       | ETC ms       |        — |        — |      — | 실험 | `2b9b6cf4`, 선택만 적용                                  |
| PICK-06 | 카운터 애니메이션 생성·편집      | P0/P2    | F95 ms/frame |        — |        — |      — | 실험 | `1b8945cf` 숫자·`8c66281b` 텍스트 필드 적용              |
| PICK-07 | 이미지 idle·active 로드          | P2       | ETC ms       |        — |        — |      — | 대기 | decode 포함                                              |
| PICK-08 | 이미지 reset·fit·투명도          | P1       | CTP ms       |        — |        — |      — | 실험 | `ad22c019` 상태 탭·`2b9b6cf4` fit 선택 적용              |
| PICK-09 | 그림자 상태·수치·색상            | P0/P1    | F95 ms/frame |        — |        — |      — | 실험 | `1b8945cf`, 그림자 수치 필드만 적용                      |
| PICK-10 | 팔레트 색상 선택·편집            | P1       | CTP ms       |        — |        — |      — | 대기 | 저장 ETC 별도                                            |

### 5.5 설정·툴바·모달·플러그인·전역

| ID       | 항목                                 | 우선순위 | 주 지표      | 기준 P95 | 개선 P95 | 개선율 | 상태 | 변경·근거                                                   |
| -------- | ------------------------------------ | -------- | ------------ | -------: | -------: | -----: | ---- | ----------------------------------------------------------- |
| SET-01   | 키 사운드 출력 변경                  | P2       | ETC ms       |        — |        — |      — | 대기 | 장치 적용                                                   |
| SET-02   | ASIO 버퍼 변경                       | P2       | ETC ms       |        — |        — |      — | 대기 | 적용·복구                                                   |
| SET-03   | 리사이즈 앵커                        | P2       | CTP ms       |        — |        — |      — | 대기 | 설정 저장                                                   |
| SET-04   | 언어 변경                            | P1       | CTP ms       |        — |        — |      — | 대기 | 전체 번역 rerender                                          |
| SET-05   | 렌더러·ANGLE 모드                    | P2       | ETC ms       |        — |        — |      — | 대기 | 재시작 상태                                                 |
| SET-06   | 플러그인 추가·재로드                 | P2       | ETC ms       |        — |        — |      — | 대기 | 진행·중복 실행                                              |
| SET-07   | 플러그인 활성화                      | P2       | CTP ms       |        — |        — |      — | 대기 | ETC·rollback                                                |
| SET-08   | 플러그인 삭제·데이터 삭제            | P2       | ETC ms       |        — |        — |      — | 대기 | 확인·목록 조정                                              |
| SET-09   | CSS 파일 로드·활성화·삭제            | P2       | ETC ms       |        — |        — |      — | 대기 | 목록 projection                                             |
| SET-10   | 단축키 캡처·삭제                     | P1/P2    | CTP ms       |        — |        — |      — | 대기 | 저장 ETC                                                    |
| SET-11   | OBS URL 복사                         | P2       | CTP ms       |        — |        — |      — | 대기 | 완료 피드백                                                 |
| SET-12   | OBS 토큰 재생성                      | P2       | ETC ms       |        — |        — |      — | 대기 | 확인·결과                                                   |
| SET-13   | 전체 초기화                          | P2       | ETC ms       |        — |        — |      — | 대기 | 전체 재부트스트랩                                           |
| SET-14   | 업데이트 확인                        | P2       | ETC ms       |        — |        — |      — | 대기 | single-flight                                               |
| TOOL-01  | 이동·지우개 도구 선택                | P3       | CTP ms       |        — |        — |      — | 대기 | 선택 표시                                                   |
| TOOL-02  | 키·통계·그래프·노브 추가 메뉴        | P1       | CTP ms       |        — |        — |      — | 실험 | `fd24b345`, 공통 popup shell 우선 표시 적용                 |
| TOOL-03  | 팔레트 열기                          | P3       | CTP ms       |        — |        — |      — | 실험 | `fd24b345`, 공통 popup shell 우선 표시 적용                 |
| TOOL-04  | 현재 탭·카운터 초기화                | P2       | ETC ms       |        — |        — |      — | 대기 | 확인·동기화                                                 |
| TOOL-05  | 기본 키 탭 전환                      | P1/P2    | CTP ms       |        — |        — |      — | 대기 | stale 응답 차단                                             |
| TOOL-06  | 커스텀 탭 팝업                       | P2/P3    | CTP ms       |        — |        — |      — | 실험 | `fd24b345`, 공통 popup shell 우선 표시 적용                 |
| TOOL-07  | 프리셋 전체·탭 저장                  | P2       | ETC ms       |        — |        — |      — | 대기 | 진행·완료                                                   |
| TOOL-08  | 프리셋 전체·탭 불러오기              | P2       | ETC ms       |        — |        — |      — | 대기 | bootstrap 완료                                              |
| TOOL-09  | 오버레이 표시                        | P2       | CTP ms       |        — |        — |      — | 대기 | 기존 optimistic+rollback                                    |
| TOOL-10  | 설정 화면 열기·뒤로                  | P1       | CTP ms       |        — |        — |      — | 대기 | 큰 화면 전환                                                |
| TOOL-11  | 노트 트랙 설정 열기                  | P3       | CTP ms       |        — |        — |      — | 실험 | `9f9631c1`, 공통 dialog shell 우선 표시 적용                |
| TOOL-12  | 외부 링크·창 최소화·닫기             | P2       | ETC ms       |        — |        — |      — | 대기 | 네이티브 호출                                               |
| MODAL-01 | 통합 키 설정 저장·취소               | P2       | ETC ms       |        — |        — |      — | 대기 | atomic commit                                               |
| MODAL-02 | 키·노트·카운터 설정 전체             | P1/P2    | CTP ms       |        — |        — |      — | 실험 | `ad22c019` 탭·`2b9b6cf4` Dropdown·`1b8945cf` 숫자 입력 적용 |
| MODAL-03 | 탭 CSS 로드·이력·저장                | P2       | ETC ms       |        — |        — |      — | 대기 | authoritative 재조회                                        |
| MODAL-04 | 탭 이름 변경                         | P2       | ETC ms       |        — |        — |      — | 대기 | validation                                                  |
| MODAL-05 | 커스텀 탭 생성·선택·삭제             | P1/P2    | ETC ms       |        — |        — |      — | 대기 | generation                                                  |
| MODAL-06 | 업데이트 다운로드·릴리스·건너뛰기    | P2       | ETC ms       |        — |        — |      — | 대기 | progress·재시도                                             |
| MODAL-07 | 플러그인 데이터 삭제                 | P2       | ETC ms       |        — |        — |      — | 대기 | 위험 액션                                                   |
| MODAL-08 | Alert·Confirm·Custom Dialog          | 기반/P3  | CTP ms       |        — |        — |      — | 실험 | `9f9631c1`, 공통 dialog shell 우선 표시 적용                |
| PLUG-01  | Promise plugin button handler        | P2       | ETC ms       |        — |        — |      — | 대기 | pending·오류 격리                                           |
| PLUG-02  | plugin input onInput                 | P0/P1    | F95 ms/frame |        — |        — |      — | 대기 | handler duration                                            |
| PLUG-03  | plugin dropdown                      | P1/P3    | CTP ms       |        — |        — |      — | 대기 | 전역 listener                                               |
| PLUG-04  | Display Element 선택·드래그·리사이즈 | P0       | F95 ms/frame |        — |        — |      — | 대기 | 호스트 Grid와 비교                                          |
| PLUG-05  | plugin remove·context action         | P2       | ETC ms       |        — |        — |      — | 대기 | 실패 조정                                                   |
| WIN-01   | 모드 전환 단축키                     | P1/P2    | CTP ms       |        — |        — |      — | 대기 | generation                                                  |
| WIN-02   | 프로퍼티 패널 토글 단축키            | P1       | CTP ms       |        — |        — |      — | 대기 | handoff 포함                                                |
| WIN-03   | 키 슬롯·단축키 실입력 캡처           | P1/P2    | CTP ms       |        — |        — |      — | 대기 | 이벤트 격리                                                 |
| WIN-04   | 분리 패널 Cmd·Ctrl+W                 | P2       | ETC ms       |        — |        — |      — | 대기 | reattach                                                    |
| WIN-05   | 오버레이 컨텍스트 메뉴               | P2       | CTP ms       |        — |        — |      — | 대기 | native menu 생성                                            |
| WIN-06   | 편집 flush 입력 잠금                 | 기반     | ETC ms       |        — |        — |      — | 대기 | 잠금 시간·피드백                                            |
| WIN-07   | focus·visibility 재동기화            | 기반     | ETC ms       |        — |        — |      — | 대기 | 사용자 입력과 경쟁 여부                                     |

## 6. 측정 세션

한 항목에 여러 세션을 추가할 수 있다. 원시 trace·프로파일 파일이 크면 저장소에 직접 넣지 않고 접근 가능한 경로나 CI artifact를 연결한다.

<!-- PILOT-01:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID  | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기      | 반복 |   P50 |   P95 |  최대 | 보조 지표                               | 원시 자료                                            | 비고             |
| -------------- | ---------- | -------- | ------ | ---------- | ---------------------------------------------------- | ------------------------- | ---: | ----: | ----: | ----: | --------------------------------------- | ---------------------------------------------------- | ---------------- |
| PILOT-01-SYNC  | 2026-08-07 | PILOT-01 | 기준선 | `123e5878` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 단일 선택·렌더 요소 500개 |   30 | 3.041 | 5.946 | 6.719 | canonical P95 5.947ms·React P95 0.723ms | [JSON](../benchmarks/results/pilot-01-baseline.json) | DOM commit proxy |
| PILOT-01-PAINT | 2026-08-07 | PILOT-01 | 개선   | `123e5878` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 단일 선택·렌더 요소 500개 |   30 | 0.345 | 0.509 | 0.649 | canonical P95 8.847ms·React P95 0.971ms | [JSON](../benchmarks/results/pilot-01-improved.json) | DOM commit proxy |

<!-- PILOT-01:SESSIONS:END -->

<!-- BASE-07:SESSIONS:START -->

| 세션 ID       | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기 | 반복 |   P50 |    P95 |   최대 | 보조 지표                                | 원시 자료                                                      | 비고             |
| ------------- | ---------- | ------- | ------ | ---------- | ---------------------------------------------------- | -------------------- | ---: | ----: | -----: | -----: | ---------------------------------------- | -------------------------------------------------------------- | ---------------- |
| BASE-07-SYNC  | 2026-08-07 | BASE-07 | 기준선 | `84917c5a` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 탭 콘텐츠 500개      |   30 | 9.537 | 10.851 | 13.574 | canonical P95 10.852ms·React P95 0.838ms | [JSON](../benchmarks/results/base-07-tab-switch-baseline.json) | DOM commit proxy |
| BASE-07-PAINT | 2026-08-07 | BASE-07 | 개선   | `84917c5a` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 탭 콘텐츠 500개      |   30 | 0.233 |  0.492 |  0.737 | canonical P95 15.393ms·React P95 1.241ms | [JSON](../benchmarks/results/base-07-tab-switch-improved.json) | DOM commit proxy |

<!-- BASE-07:SESSIONS:END -->

<!-- BASE-03:SESSIONS:START -->

| 세션 ID       | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기 | 반복 |    P50 |    P95 |   최대 | 보조 지표                                | 원시 자료                                                    | 비고             |
| ------------- | ---------- | ------- | ------ | ---------- | ---------------------------------------------------- | -------------------- | ---: | -----: | -----: | -----: | ---------------------------------------- | ------------------------------------------------------------ | ---------------- |
| BASE-03-SYNC  | 2026-08-07 | BASE-03 | 기준선 | `138ce232` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 선택 콘텐츠 500개    |   30 | 10.181 | 10.981 | 10.993 | canonical P95 10.983ms·React P95 0.902ms | [JSON](../benchmarks/results/base-03-dropdown-baseline.json) | DOM commit proxy |
| BASE-03-PAINT | 2026-08-07 | BASE-03 | 개선   | `138ce232` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 선택 콘텐츠 500개    |   30 |  0.234 |  0.336 |  0.360 | canonical P95 14.247ms·React P95 0.984ms | [JSON](../benchmarks/results/base-03-dropdown-improved.json) | DOM commit proxy |

<!-- BASE-03:SESSIONS:END -->

<!-- BASE-04:SESSIONS:START -->

| 세션 ID       | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기 | 반복 |    P50 |    P95 |   최대 | 보조 지표                                 | 원시 자료                                                        | 비고             |
| ------------- | ---------- | ------- | ------ | ---------- | ---------------------------------------------------- | -------------------- | ---: | -----: | -----: | -----: | ----------------------------------------- | ---------------------------------------------------------------- | ---------------- |
| BASE-04-SYNC  | 2026-08-07 | BASE-04 | 기준선 | `25de3261` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 부모 콘텐츠 500개    |   30 | 11.451 | 12.316 | 12.326 | canonical P95 12.317ms·event P95 12.302ms | [JSON](../benchmarks/results/base-04-number-input-baseline.json) | DOM commit proxy |
| BASE-04-PAINT | 2026-08-07 | BASE-04 | 개선   | `25de3261` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 부모 콘텐츠 500개    |   30 |  0.185 |  0.323 |  0.429 | canonical P95 15.134ms·event P95 0.315ms  | [JSON](../benchmarks/results/base-04-number-input-improved.json) | DOM commit proxy |

<!-- BASE-04:SESSIONS:END -->

<!-- BASE-05:SESSIONS:START -->

| 세션 ID       | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기 | 반복 |   P50 |    P95 |   최대 | 보조 지표                                 | 원시 자료                                                      | 비고             |
| ------------- | ---------- | ------- | ------ | ---------- | ---------------------------------------------------- | -------------------- | ---: | ----: | -----: | -----: | ----------------------------------------- | -------------------------------------------------------------- | ---------------- |
| BASE-05-SYNC  | 2026-08-07 | BASE-05 | 기준선 | `02b6bd36` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 부모 콘텐츠 500개    |   30 | 7.309 | 14.968 | 19.801 | canonical P95 14.970ms·event P95 14.927ms | [JSON](../benchmarks/results/base-05-text-input-baseline.json) | DOM commit proxy |
| BASE-05-PAINT | 2026-08-07 | BASE-05 | 개선   | `02b6bd36` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 부모 콘텐츠 500개    |   30 | 0.225 |  0.445 |  0.792 | canonical P95 19.173ms·event P95 0.434ms  | [JSON](../benchmarks/results/base-05-text-input-improved.json) | DOM commit proxy |

<!-- BASE-05:SESSIONS:END -->

<!-- BASE-06:SESSIONS:START -->

| 세션 ID       | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기 | 반복 |   P50 |    P95 |   최대 | 보조 지표                             | 원시 자료                                                       | 비고             |
| ------------- | ---------- | ------- | ------ | ---------- | ---------------------------------------------------- | -------------------- | ---: | ----: | -----: | -----: | ------------------------------------- | --------------------------------------------------------------- | ---------------- |
| BASE-06-SYNC  | 2026-08-07 | BASE-06 | 기준선 | `14d7427b` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 피커 DOM 500개       |   30 | 7.109 | 10.828 | 17.636 | picker P95 10.898ms·event P95 0.085ms | [JSON](../benchmarks/results/base-06-color-input-baseline.json) | DOM commit proxy |
| BASE-06-PAINT | 2026-08-07 | BASE-06 | 개선   | `14d7427b` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 피커 DOM 500개       |   30 | 0.189 |  0.268 |  0.279 | picker P95 14.353ms·event P95 0.114ms | [JSON](../benchmarks/results/base-06-color-input-improved.json) | DOM commit proxy |

<!-- BASE-06:SESSIONS:END -->

<!-- BASE-08:SESSIONS:START -->

| 세션 ID       | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기 | 반복 |    P50 |    P95 |   최대 | 보조 지표                              | 원시 자료                                                          | 비고             |
| ------------- | ---------- | ------- | ------ | ---------- | ---------------------------------------------------- | -------------------- | ---: | -----: | -----: | -----: | -------------------------------------- | ------------------------------------------------------------------ | ---------------- |
| BASE-08-SYNC  | 2026-08-07 | BASE-08 | 기준선 | `264725fb` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 메뉴 DOM 500개       |   30 | 17.430 | 23.983 | 24.954 | content P95 24.057ms·event P95 0.078ms | [JSON](../benchmarks/results/base-08-floating-popup-baseline.json) | DOM commit proxy |
| BASE-08-PAINT | 2026-08-07 | BASE-08 | 개선   | `264725fb` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 메뉴 DOM 500개       |   30 |  7.464 | 10.642 | 11.100 | content P95 21.149ms·event P95 0.098ms | [JSON](../benchmarks/results/base-08-floating-popup-improved.json) | DOM commit proxy |

<!-- BASE-08:SESSIONS:END -->

<!-- BASE-09:SESSIONS:START -->

| 세션 ID       | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기 | 반복 |    P50 |    P95 |   최대 | 보조 지표                              | 원시 자료                                                 | 비고             |
| ------------- | ---------- | ------- | ------ | ---------- | ---------------------------------------------------- | -------------------- | ---: | -----: | -----: | -----: | -------------------------------------- | --------------------------------------------------------- | ---------------- |
| BASE-09-SYNC  | 2026-08-07 | BASE-09 | 기준선 | `a9598cdd` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 본문 DOM 500개       |   30 | 10.225 | 13.454 | 14.312 | content P95 13.551ms·event P95 0.083ms | [JSON](../benchmarks/results/base-09-modal-baseline.json) | DOM commit proxy |
| BASE-09-PAINT | 2026-08-07 | BASE-09 | 개선   | `a9598cdd` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 본문 DOM 500개       |   30 |  1.167 |  4.308 |  4.336 | content P95 14.451ms·event P95 0.133ms | [JSON](../benchmarks/results/base-09-modal-improved.json) | DOM commit proxy |

<!-- BASE-09:SESSIONS:END -->

<!-- GRID-05:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                       | 시나리오·데이터 크기     | 반복 |   P50 |   P95 |  최대 | 보조 지표                          | 원시 자료                                                      | 비고                |
| -------------- | ---------- | ------- | ------ | ---------- | ---------------------------------------------------------- | ------------------------ | ---: | ----: | ----: | ----: | ---------------------------------- | -------------------------------------------------------------- | ------------------- |
| GRID-05-LEGACY | 2026-08-07 | GRID-05 | 기준선 | `19f65903` | vitest-jsdom-middle-pan-burst-proxy, darwin arm64, v25.2.1 | DOM 500개·mousemove 20회 |   30 | 0.217 | 0.306 | 0.337 | DOM P95 11.655ms·React P95 1.362ms | [JSON](../benchmarks/results/grid-05-middle-pan-baseline.json) | pointer burst proxy |
| GRID-05-FRAME  | 2026-08-07 | GRID-05 | 개선   | `19f65903` | vitest-jsdom-middle-pan-burst-proxy, darwin arm64, v25.2.1 | DOM 500개·mousemove 20회 |   30 | 0.185 | 0.225 | 0.251 | DOM P95 11.384ms·React P95 1.067ms | [JSON](../benchmarks/results/grid-05-middle-pan-improved.json) | pointer burst proxy |

<!-- GRID-05:SESSIONS:END -->

<!-- GRID-09:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                    | 시나리오·데이터 크기     | 반복 |   P50 |   P95 |  최대 | 보조 지표                         | 원시 자료                                                   | 비고                |
| -------------- | ---------- | ------- | ------ | ---------- | ------------------------------------------------------- | ------------------------ | ---: | ----: | ----: | ----: | --------------------------------- | ----------------------------------------------------------- | ------------------- |
| GRID-09-LEGACY | 2026-08-07 | GRID-09 | 기준선 | `a9d8d465` | vitest-jsdom-marquee-burst-proxy, darwin arm64, v25.2.1 | DOM 500개·mousemove 20회 |   30 | 0.224 | 0.261 | 0.328 | DOM P95 6.321ms·React P95 0.906ms | [JSON](../benchmarks/results/grid-09-marquee-baseline.json) | marquee burst proxy |
| GRID-09-FRAME  | 2026-08-07 | GRID-09 | 개선   | `a9d8d465` | vitest-jsdom-marquee-burst-proxy, darwin arm64, v25.2.1 | DOM 500개·mousemove 20회 |   30 | 0.111 | 0.139 | 0.139 | DOM P95 5.033ms·React P95 0.932ms | [JSON](../benchmarks/results/grid-09-marquee-improved.json) | marquee burst proxy |

<!-- GRID-09:SESSIONS:END -->

<!-- GRID-06:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                   | 시나리오·데이터 크기     | 반복 |   P50 |   P95 |  최대 | 보조 지표                         | 원시 자료                                                  | 비고               |
| -------------- | ---------- | ------- | ------ | ---------- | ------------------------------------------------------ | ------------------------ | ---: | ----: | ----: | ----: | --------------------------------- | ---------------------------------------------------------- | ------------------ |
| GRID-06-LEGACY | 2026-08-07 | GRID-06 | 기준선 | `d092017a` | vitest-jsdom-resize-burst-proxy, darwin arm64, v25.2.1 | DOM 500개·mousemove 20회 |   30 | 0.119 | 0.155 | 0.162 | DOM P95 7.589ms·React P95 1.154ms | [JSON](../benchmarks/results/grid-06-resize-baseline.json) | resize burst proxy |
| GRID-06-FRAME  | 2026-08-07 | GRID-06 | 개선   | `d092017a` | vitest-jsdom-resize-burst-proxy, darwin arm64, v25.2.1 | DOM 500개·mousemove 20회 |   30 | 0.114 | 0.144 | 0.158 | DOM P95 8.699ms·React P95 1.390ms | [JSON](../benchmarks/results/grid-06-resize-improved.json) | resize burst proxy |

<!-- GRID-06:SESSIONS:END -->

<!-- GRID-08:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                          | 시나리오·데이터 크기                | 반복 |   P50 |   P95 |  최대 | 보조 지표                         | 원시 자료                                                         | 비고                      |
| -------------- | ---------- | ------- | ------ | ---------- | ------------------------------------------------------------- | ----------------------------------- | ---: | ----: | ----: | ----: | --------------------------------- | ----------------------------------------------------------------- | ------------------------- |
| GRID-08-LEGACY | 2026-08-07 | GRID-08 | 기준선 | `50147d66` | vitest-jsdom-gradient-stop-burst-proxy, darwin arm64, v25.2.1 | preview 구독 500개·pointermove 20회 |   30 | 0.345 | 0.405 | 0.406 | DOM P95 3.076ms·React P95 2.145ms | [JSON](../benchmarks/results/grid-08-gradient-axis-baseline.json) | gradient stop burst proxy |
| GRID-08-FRAME  | 2026-08-07 | GRID-08 | 개선   | `50147d66` | vitest-jsdom-gradient-stop-burst-proxy, darwin arm64, v25.2.1 | preview 구독 500개·pointermove 20회 |   30 | 0.114 | 0.137 | 0.163 | DOM P95 4.391ms·React P95 2.220ms | [JSON](../benchmarks/results/grid-08-gradient-axis-improved.json) | gradient stop burst proxy |

<!-- GRID-08:SESSIONS:END -->

<!-- GRID-11:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID | 단계   | 빌드·커밋  | 환경                                                         | 시나리오·데이터 크기      | 반복 |   P50 |   P95 |  최대 | 보조 지표                         | 원시 자료                                                   | 비고               |
| -------------- | ---------- | ------- | ------ | ---------- | ------------------------------------------------------------ | ------------------------- | ---: | ----: | ----: | ----: | --------------------------------- | ----------------------------------------------------------- | ------------------ |
| GRID-11-LEGACY | 2026-08-07 | GRID-11 | 기준선 | `1ca33879` | vitest-jsdom-minimap-drag-burst-proxy, darwin arm64, v25.2.1 | SVG 500개·mousemove 100회 |   30 | 0.564 | 0.711 | 0.835 | DOM P95 3.864ms·React P95 2.740ms | [JSON](../benchmarks/results/grid-11-minimap-baseline.json) | minimap drag proxy |
| GRID-11-FRAME  | 2026-08-07 | GRID-11 | 개선   | `1ca33879` | vitest-jsdom-minimap-drag-burst-proxy, darwin arm64, v25.2.1 | SVG 500개·mousemove 100회 |   30 | 0.471 | 0.569 | 0.985 | DOM P95 4.783ms·React P95 2.503ms | [JSON](../benchmarks/results/grid-11-minimap-improved.json) | minimap drag proxy |

<!-- GRID-11:SESSIONS:END -->

### 6.1 실제 브라우저 세션

| 세션 ID               | 날짜       | 항목 ID  | 단계   | 빌드·커밋  | 환경                     | 시나리오·데이터 크기  | 반복 | P50 |    P95 | 최대 | 보조 지표          | 원시 자료                                                | 비고                    |
| --------------------- | ---------- | -------- | ------ | ---------- | ------------------------ | --------------------- | ---: | --: | -----: | ---: | ------------------ | -------------------------------------------------------- | ----------------------- |
| PILOT-01-CHROME-SYNC  | 2026-08-07 | PILOT-01 | 기준선 | `809f8fe1` | Chrome 151, darwin-arm64 | 단일 선택, 요소 500개 |   40 |   — | 11.300 |    — | paint P95 34.100ms | [JSON](../benchmarks/results/pilot-01-chromium-p95.json) | 실제 Chromium 렌더 경로 |
| PILOT-01-CHROME-PAINT | 2026-08-07 | PILOT-01 | 개선   | `809f8fe1` | Chrome 151, darwin-arm64 | 단일 선택, 요소 500개 |   40 |   — |  3.100 |    — | paint P95 34.200ms | [JSON](../benchmarks/results/pilot-01-chromium-p95.json) | 실제 Chromium 렌더 경로 |

<!-- PILOT-02:SESSIONS:START -->

| 세션 ID        | 날짜       | 항목 ID  | 단계   | 빌드·커밋  | 환경                                                 | 시나리오·데이터 크기      | 반복 |   P50 |   P95 |  최대 | 보조 지표                                | 원시 자료                                            | 비고                   |
| -------------- | ---------- | -------- | ------ | ---------- | ---------------------------------------------------- | ------------------------- | ---: | ----: | ----: | ----: | ---------------------------------------- | ---------------------------------------------------- | ---------------------- |
| PILOT-02-SYNC  | 2026-08-07 | PILOT-02 | 기준선 | `123e5878` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 다중 선택·렌더 요소 500개 |   30 | 3.760 | 8.385 | 8.660 | canonical P95 8.387ms·React P95 0.810ms  | [JSON](../benchmarks/results/pilot-02-baseline.json) | batch DOM commit proxy |
| PILOT-02-PAINT | 2026-08-07 | PILOT-02 | 개선   | `123e5878` | vitest-jsdom-dom-commit-proxy, darwin arm64, v25.2.1 | 다중 선택·렌더 요소 500개 |   30 | 0.361 | 0.550 | 0.556 | canonical P95 10.648ms·React P95 1.009ms | [JSON](../benchmarks/results/pilot-02-improved.json) | batch DOM commit proxy |

<!-- PILOT-02:SESSIONS:END -->

## 7. 실험 기록

최적화 하나당 아래 블록을 복사한다.

<!-- PILOT-01:EXPERIMENT:START -->

### EXP-001: 그림자 사용 토글 시각 반응 우선 처리

| 필드               | 내용                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 항목 ID            | PILOT-01                                                                                                                       |
| 가설               | 무거운 문서 상태 커밋을 첫 paint 뒤로 미루면 토글의 시각 반응이 선택 요소 수와 무관하게 빨라진다.                              |
| 변경 내용          | 로컬 checked를 먼저 반영하고 `requestAnimationFrame` 다음 태스크에서 canonical 상태를 커밋한다. 연타는 마지막 의도로 병합한다. |
| 적용 기법          | 낙관적 상태 투영·메인 스레드 양보·입력 병합                                                                                    |
| 커밋·PR            | `123e5878`                                                                                                                     |
| 기준선 세션        | PILOT-01-SYNC                                                                                                                  |
| 개선 후 세션       | PILOT-01-PAINT                                                                                                                 |
| P50 변화           | 3.041ms → 0.345ms (88.6%)                                                                                                      |
| P95 변화           | 5.946ms → 0.509ms (91.4%)                                                                                                      |
| canonical P95 변화 | 5.947ms → 8.847ms (-48.8%)                                                                                                     |
| 정확성 검증        | 마지막 의도 병합·paint 전 unmount 의도 보존·접근성 checked 상태 단위 테스트 통과                                               |
| 플랫폼 검증        | jsdom proxy 완료·실제 Chromium 세션은 6.1 참조·macOS WKWebView 및 Windows WebView2 대기                                        |
| 결론               | WebView 실측 전까지 검증 상태로 유지                                                                                           |
| 후속 작업          | 실제 WebView CTP 측정 후 PILOT-02와 공통 정책 후보로 확대                                                                      |

<!-- PILOT-01:EXPERIMENT:END -->

<!-- PILOT-02:EXPERIMENT:START -->

### EXP-002: 다중 선택 그림자 사용 토글 시각 반응 검증

| 필드               | 내용                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| 항목 ID            | PILOT-02                                                                        |
| 가설               | 공통 컨트롤의 로컬 checked 반영은 전체 선택 요소의 배치 변환보다 먼저 표시된다. |
| 변경 내용          | PILOT-01에서 적용한 공통 `ShadowControls` 계약을 다중 선택 경로에서 재사용한다. |
| 적용 기법          | 낙관적 상태 투영·메인 스레드 양보·입력 병합                                     |
| 커밋·PR            | `123e5878`                                                                      |
| 기준선 세션        | PILOT-02-SYNC                                                                   |
| 개선 후 세션       | PILOT-02-PAINT                                                                  |
| P95 변화           | 8.385ms → 0.550ms (93.4%)                                                       |
| canonical P95 변화 | 8.387ms → 10.648ms (-27.0%)                                                     |
| 정확성 검증        | 요소별 그림자 값 보존·통계 activeShadow 차단·연타 마지막 의도 보존 테스트 통과  |
| 플랫폼 검증        | jsdom batch proxy 완료·실제 WebView 대기                                        |
| 결론               | 공통 최적화가 다중 선택에도 유효하며 WebView 실측 전까지 검증 상태로 유지       |
| 후속 작업          | 공통 Checkbox 확대 전 BASE-01 사용처별 상태 소유권 분류                         |

<!-- PILOT-02:EXPERIMENT:END -->

### EXP-003: 공통 Checkbox 시각 우선 커밋 계약

| 필드        | 내용                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| 항목 ID     | BASE-01                                                                                                                  |
| 가설        | 상태 소유권을 강제로 바꾸지 않고 옵트인 계약을 제공하면 느린 토글만 안전하게 paint와 canonical 작업을 분리할 수 있다.    |
| 변경 내용   | `useOptimisticBooleanCommit` 공통 훅과 Checkbox의 선택적 `commitStrategy`를 추가하고 그림자 토글의 중복 구현을 교체했다. |
| 안전 기본값 | 기존 36개 JSX 사용처는 `sync` 유지, 검증된 사용처만 `after-paint` 옵트인                                                 |
| 정확성 검증 | sync 호환·즉시 시각 반영·연타 병합·언마운트 의도 보존 테스트 통과                                                        |
| 성능 근거   | PILOT-01 단일 선택과 PILOT-02 다중 선택 자동 비교 결과                                                                   |
| 결론        | 공통 기반 채택, 사용처별 저장·rollback 계약 분류 후 단계 확대                                                            |

### EXP-004: 프로퍼티 패널 P1 토글 첫 확대

| 필드        | 내용                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------- |
| 항목 ID     | TOG-15~21, TOG-27~29                                                                           |
| 적용 범위   | 단일·다중 선택의 인라인 스타일, 사운드, 노트 효과, Y축 보정, 글로우, 카운터, 카운터 애니메이션 |
| 변경 내용   | 공통 Checkbox의 `after-paint` 전략을 14개 사용처에 옵트인                                      |
| 커밋·PR     | `07976df8`                                                                                     |
| 안전성 분류 | 실패 rollback이 필요한 원격·IPC 토글을 제외하고 기존 로컬 상태 커밋 경로만 적용                |
| 정확성 검증 | 타입 검사·린트·공통 Checkbox 및 다중 선택 관련 20개 테스트 통과                                |
| 성능 값     | 개별 사용처 기준선·개선 후 WebView CTP 미측정 — 실측 전까지 수치 미기재                        |
| 결론        | 구현은 실험 상태이며 실제 WebView 자동 측정과 사용처별 정합성 검증 후 완료 여부 결정           |

### EXP-005: Grid·그래프·노브 토글 확대

| 필드        | 내용                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| 항목 ID     | TOG-11~14, TOG-22~26, TOG-30                                                                  |
| 적용 범위   | Grid 미니맵·스마트 가이드, 단일·다중 그래프 평균선·애니메이션, 그래프·노브 스타일과 방향 반전 |
| 변경 내용   | 공통 Checkbox의 `after-paint` 전략을 사용자 표면 14개에 옵트인                                |
| 커밋·PR     | `99e64f07`                                                                                    |
| 안전성 분류 | 로컬 상태를 먼저 갱신하는 그래프·노브 경로와 로컬 갱신 후 저장 IPC를 실행하는 Grid 경로       |
| 정확성 검증 | 타입 검사·린트·공통 Checkbox, 패널 계약, 배치 handler, 렌더 계약의 34개 테스트 통과           |
| 성능 값     | 개별 WebView CTP와 Grid 드래그·리사이즈 F95 미측정 — 실측 전까지 수치 미기재                  |
| 결론        | 구현은 실험 상태이며 플랫폼 자동 측정과 저장 실패 재동기화 검증 후 완료 여부 결정             |

### EXP-006: 설정 토글 행 시각 우선 계약

| 필드        | 내용                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------- |
| 항목 ID     | BASE-02, TOG-01~10                                                                                 |
| 적용 범위   | 오버레이 잠금, 항상 위, 전역 노트·카운터, 트레이, OBS, 자동 업데이트, 개발자 모드, 커스텀 CSS·JS   |
| 변경 내용   | 행 버튼이 소유한 `SettingToggleRow`에 선택적 `after-paint` 계약을 추가하고 10개 설정 표면에 옵트인 |
| 커밋·PR     | `05c02e43`                                                                                         |
| 정확성 검증 | 기본 sync 호환·행과 장식 체크박스의 동시 시각 반영·연타 최종 의도 병합 테스트 통과                 |
| 성능 값     | 개별 WebView CTP와 IPC·서비스 ETC 미측정 — 실측 전까지 수치 미기재                                 |
| 남은 게이트 | 저장·IPC 실패 시 authoritative 재동기화, OBS 연속 조작, macOS WKWebView·Windows WebView2 자동 측정 |
| 결론        | 공통 기반과 사용처 구현은 실험 상태이며 실패 정합성과 플랫폼 측정 후 완료 여부 결정                |

### EXP-007: 편집 모달·플러그인 boolean 토글 확대

| 필드        | 내용                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| 항목 ID     | TOG-32~34                                                                               |
| 적용 범위   | 이미지 투명화, 카운터·노트 편집 모달의 로컬 토글, 플러그인 설정 스키마의 boolean 컨트롤 |
| 변경 내용   | 공통 Checkbox의 `after-paint` 전략을 8개 코드 사용처에 옵트인                           |
| 커밋·PR     | `e923a837`                                                                              |
| 안전성 분류 | 모달 임시 상태·preview와 동기 플러그인 요소 store 갱신 경로                             |
| 정확성 검증 | 타입 검사·린트·Checkbox, 노트 설정, 플러그인 설정·패널 계약의 46개 테스트 통과          |
| 성능 값     | 이미지 paint·preview·플러그인 저장 병합 CTP 미측정 — 실측 전까지 수치 미기재            |
| 결론        | 구현은 실험 상태이며 개별 표면 측정과 플러그인 설정 저장 정합성 검증 후 완료 여부 결정  |

### EXP-008: 비동기 탭 CSS 토글 낙관 상태 직렬화

| 필드        | 내용                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------- |
| 항목 ID     | TOG-31                                                                                   |
| 변경 내용   | 비동기 성공까지 시각 상태를 유지하고 실패 시 canonical 값으로 rollback하는 공통 훅 적용  |
| 적용 기법   | 낙관적 상태 투영·첫 paint 뒤 요청·요청 직렬화·연타 병합·실패 rollback                    |
| 커밋·PR     | `c9c10ee7`                                                                               |
| 정확성 검증 | 시각 선반영·성공 유지·실패 rollback·요청 중 마지막 의도 직렬화·paint 전 상쇄 테스트 통과 |
| 성능 값     | 실제 WebView CTP와 CSS toggle ETC 미측정 — 실측 전까지 수치 미기재                       |
| 결론        | 기능 계약은 검증됐으며 백엔드 오류 주입과 플랫폼 실측 후 완료 여부 결정                  |

<!-- BASE-07:EXPERIMENT:START -->

### EXP-009: 공통 TabSwitch 시각 우선 전환

| 필드        | 내용                                                                                    |
| ----------- | --------------------------------------------------------------------------------------- |
| 항목 ID     | BASE-07                                                                                 |
| 적용 범위   | 키 슬롯, 색상 상태·형식, 이미지 상태, 통합 키 설정, 노트 설정의 6개 탭 전환             |
| 변경 내용   | 활성 인디케이터와 `aria-pressed`를 먼저 반영하고 탭 콘텐츠 상태 변경을 첫 paint 뒤 커밋 |
| 적용 기법   | 낙관적 상태 투영·메인 스레드 양보·연속 탭 선택 병합                                     |
| 커밋·PR     | `84917c5a`                                                                              |
| P95 변화    | 10.851ms → 0.492ms (95.5%)                                                              |
| 정확성 검증 | sync 호환·시각 선반영·마지막 탭 병합·언마운트 선택 보존 테스트 통과                     |
| 결론        | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지                       |

<!-- BASE-07:EXPERIMENT:END -->

<!-- BASE-03:EXPERIMENT:START -->

### EXP-010: 공통 Dropdown 선택 시각 우선 반영

| 필드        | 내용                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| 항목 ID     | BASE-03                                                                           |
| 적용 범위   | 프로퍼티 패널·통합 설정 모달·피커의 로컬 선택 22곳                                |
| 변경 내용   | 메뉴 닫힘·포커스 복원·선택 라벨을 먼저 반영하고 canonical 선택은 첫 paint 뒤 커밋 |
| 적용 기법   | 낙관적 상태 투영·메인 스레드 양보·연속 선택 병합                                  |
| 구현 커밋   | `2b9b6cf4`                                                                        |
| P95 변화    | 10.981ms → 0.336ms (96.9%)                                                        |
| 정확성 검증 | sync 기본값·메뉴 닫힘·포커스 복원·라벨 선반영·선택 콜백 지연 테스트 통과          |
| 결론        | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지                 |

<!-- BASE-03:EXPERIMENT:END -->

<!-- BASE-04:EXPERIMENT:START -->

### EXP-011: 공통 숫자 입력 로컬 echo 우선 반영

| 필드        | 내용                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| 항목 ID     | BASE-04                                                                             |
| 적용 범위   | NumberInput 56곳·OptionalNumberInput 6곳, 총 62곳                                   |
| 변경 내용   | input 로컬 문자열을 먼저 반영하고 부모 preview·commit은 첫 paint 뒤 실행            |
| 적용 기법   | 로컬 echo·메인 스레드 양보·연속 입력 병합·blur flush·Escape 취소                    |
| 구현 커밋   | `1b8945cf`                                                                          |
| P95 변화    | 12.316ms → 0.323ms (97.4%)                                                          |
| 정확성 검증 | sync 호환·최종값 병합·blur 확정·Escape 취소·unmount 보존·Optional 빈 값 테스트 통과 |
| 결론        | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지                   |

<!-- BASE-04:EXPERIMENT:END -->

<!-- BASE-05:EXPERIMENT:START -->

### EXP-012: 공통 텍스트·검색 입력 로컬 echo 우선 반영

| 필드        | 내용                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| 항목 ID     | BASE-05                                                                       |
| 적용 범위   | TextInput 8곳·SearchField 2곳, 총 10곳                                        |
| 변경 내용   | 로컬 문자열을 먼저 반영하고 부모 preview·목록 필터는 첫 paint 뒤 실행         |
| 적용 기법   | 로컬 echo·메인 스레드 양보·연속 입력 병합·blur/lifecycle flush·Escape 취소    |
| 구현 커밋   | `8c66281b`                                                                    |
| P95 변화    | 14.968ms → 0.445ms (97.0%)                                                    |
| 정확성 검증 | sync 호환·blur 확정·lifecycle 정산·Escape 취소·검색 외부값 동기화 테스트 통과 |
| 결론        | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지             |

<!-- BASE-05:EXPERIMENT:END -->

<!-- BASE-06:EXPERIMENT:START -->

### EXP-013: 공통 색상 피커 표시 분리

| 필드        | 내용                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------- |
| 항목 ID     | BASE-06                                                                                     |
| 적용 범위   | 프로퍼티 패널 ColorInput 10곳과 공통 ColorSwatchButton 표면                                 |
| 변경 내용   | 스와치 focus ring·aria-expanded를 먼저 반영하고 무거운 ColorPicker mount는 첫 paint 뒤 실행 |
| 적용 기법   | 시각 피드백 분리·지연 mount·예약 취소·동기 외부 제어 호환                                   |
| 구현 커밋   | `cb3335bd`                                                                                  |
| P95 변화    | 10.828ms → 0.268ms (97.5%)                                                                  |
| 정확성 검증 | sync 호환·예약 취소·상태 capability·분리 패널 계약 테스트 통과                              |
| 결론        | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지                           |

<!-- BASE-06:EXPERIMENT:END -->

<!-- BASE-08:EXPERIMENT:START -->

### EXP-014: 공통 팝업 콘텐츠 표시 분리

| 필드        | 내용                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------- |
| 항목 ID     | BASE-08                                                                                      |
| 적용 범위   | 공통 ListPopup 전체와 팔레트·커스텀 탭 FloatingPopup                                         |
| 변경 내용   | opener aria-expanded·빈 popup shell을 먼저 반영하고 무거운 children mount를 첫 paint 뒤 실행 |
| 적용 기법   | 시각 피드백 분리·지연 mount·예약 취소·초기 포커스 인계                                       |
| 구현 커밋   | `fd24b345`                                                                                   |
| P95 변화    | 23.983ms → 10.642ms (55.6%)                                                                  |
| 정확성 검증 | sync 호환·예약 취소·첫 항목 포커스·키보드·중첩 팝업 계층 계약 테스트 통과                    |
| 결론        | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지                            |

<!-- BASE-08:EXPERIMENT:END -->

<!-- BASE-09:EXPERIMENT:START -->

### EXP-015: 공통 모달 콘텐츠 표시 분리

| 필드        | 내용                                                                           |
| ----------- | ------------------------------------------------------------------------------ |
| 항목 ID     | BASE-09                                                                        |
| 적용 범위   | 공통 Modal을 사용하는 설정·편집·확인 표면 9곳                                  |
| 변경 내용   | dialog backdrop·shell을 먼저 반영하고 무거운 children mount를 첫 paint 뒤 실행 |
| 적용 기법   | 시각 피드백 분리·지연 mount·예약 취소·초기 포커스 인계                         |
| 구현 커밋   | `9f9631c1`                                                                     |
| P95 변화    | 13.454ms → 4.308ms (68.0%)                                                     |
| 정확성 검증 | sync 호환·첫 항목 포커스·포커스 복원·Tab·Escape·중첩 popup 계약 테스트 통과    |
| 결론        | jsdom DOM proxy에서 검증, 실제 WebView 측정 전까지 검증 상태 유지              |

<!-- BASE-09:EXPERIMENT:END -->

<!-- GRID-05:EXPERIMENT:START -->

### EXP-016: Grid 연속 이동 입력 프레임 병합

| 필드        | 내용                                                                           |
| ----------- | ------------------------------------------------------------------------------ |
| 항목 ID     | GRID-03~05                                                                     |
| 변경 내용   | 휠·트랙패드 delta를 누적하고 미들 팬 최신 좌표를 프레임당 한 번 Store에 반영   |
| 구현 커밋   | `9c90cae8`                                                                     |
| P95 변화    | 0.306ms → 0.225ms (26.3%)                                                      |
| 정확성 검증 | 입력 손실 없는 delta 누적·mouseup flush·기존 단일·다중 드래그 병합 테스트 통과 |
| 결론        | jsdom burst proxy 검증, 실제 WebView F95 측정 전까지 검증 상태 유지            |

<!-- GRID-05:EXPERIMENT:END -->

<!-- GRID-09:EXPERIMENT:START -->

### EXP-017: Grid 마퀴 좌표 프레임 병합

| 필드        | 내용                                                                                 |
| ----------- | ------------------------------------------------------------------------------------ |
| 항목 ID     | GRID-09                                                                              |
| 변경 내용   | mousemove 최신 좌표를 프레임당 한 번 Store에 반영하고 mouseup 전에 마지막 좌표 flush |
| 구현 커밋   | `f96cdd57`                                                                           |
| P95 변화    | 0.261ms → 0.139ms (47.0%)                                                            |
| 정확성 검증 | 프레임 병합·최종 좌표·선택 종료 테스트 통과                                          |
| 결론        | jsdom burst proxy 검증, 실제 WebView F95 측정 전까지 검증 상태 유지                  |

<!-- GRID-09:EXPERIMENT:END -->

<!-- GRID-06:EXPERIMENT:START -->

### EXP-018: Grid 리사이즈 입력 프레임 병합

| 필드        | 내용                                                                              |
| ----------- | --------------------------------------------------------------------------------- |
| 항목 ID     | GRID-06~07                                                                        |
| 변경 내용   | 단일·그룹 mousemove 최신 bounds만 프레임당 한 번 계산·preview하고 종료 전에 flush |
| 구현 커밋   | `78fb15eb`                                                                        |
| P95 변화    | 0.155ms → 0.144ms (7.2%)                                                          |
| 정확성 검증 | 공통 scheduler·최신 bounds·mouseup flush·resize commit 테스트 통과                |
| 결론        | 단일 경로 jsdom 검증, 그룹 선택 수별 WebView 측정 전까지 GRID-07은 실험 상태 유지 |

<!-- GRID-06:EXPERIMENT:END -->

<!-- GRID-08:EXPERIMENT:START -->

### EXP-019: 그라데이션 축·스톱 입력 프레임 병합

| 필드        | 내용                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| 항목 ID     | GRID-08, EDIT-03                                                                              |
| 변경 내용   | rotate·stop pointermove 최신 좌표만 프레임당 한 번 preview하고 종료 전에 flush·최종 좌표 커밋 |
| 구현 커밋   | `23582b9a`                                                                                    |
| P95 변화    | 0.405ms → 0.137ms (66.2%)                                                                     |
| 정확성 검증 | frame 병합·pointerup 최종 좌표·세션 교체·취소 롤백 테스트 통과                                |
| 결론        | GRID-08 검증 완료, EDIT-03의 stop 드래그 경로 적용·형식 전환은 공통 탭 즉시 반영 기반 사용    |

<!-- GRID-08:EXPERIMENT:END -->

<!-- GRID-11:EXPERIMENT:START -->

### EXP-020: 미니맵 드래그 입력 프레임 병합

| 필드        | 내용                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| 항목 ID     | GRID-11                                                                |
| 변경 내용   | mousemove 최신 좌표만 프레임당 한 번 pan에 반영하고 mouseup 전에 flush |
| 구현 커밋   | `25a0c0a3`                                                             |
| P95 변화    | 0.711ms → 0.569ms (19.9%)                                              |
| 정확성 검증 | 프레임 최신 좌표·mouseup flush·최종 pan 테스트 통과                    |
| 결론        | 자동 회귀 게이트 포함 검증 완료                                        |

<!-- GRID-11:EXPERIMENT:END -->

## 8. 완료 게이트

성능이 빨라졌더라도 다음 항목 중 하나가 깨지면 완료 처리하지 않는다.

- 마지막 사용자 의도가 최종 상태에 보존됨
- 실패 시 rollback 또는 authoritative 재동기화가 동작함
- 빠른 연속 입력과 중복 실행이 안전함
- 취소·Escape·blur·저장 경합이 안전함
- Undo/Redo와 외부 상태 변경이 정확함
- 접근성 역할·키보드 조작·포커스 복원이 유지됨
- macOS·Windows의 실제 WebView에서 검증됨
- 기존 테스트와 관련 신규 테스트가 통과함

## 9. 우선 적용 순서

1. `PILOT-01` 단일 선택 그림자 사용 토글
2. `PILOT-02` 다중 선택 그림자 사용 토글
3. `BASE-13`, `GRID-*`, `LAYER-08~09`, `PROP-03~04`, `EDIT-*`의 P0 경로
4. 나머지 프로퍼티·토글 P1 경로
5. IPC·파일·플러그인 P2 경로
6. 검증된 계약의 공통 컴포넌트 확대
