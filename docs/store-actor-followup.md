# 저장 실행기 후속 설계

> 작성일: 2026-08-27
>
> 상태: 현 실행기 계약 정리 + 후속 과제 등록
>
> 배경: PR #143에서 `editor_commit` 계열 저장 커맨드가 메인 스레드 밖 FIFO 실행기(번호표)로 옮겨졌다.
> 이 문서는 그 실행기의 계약과 규칙, 아직 하지 않은 것을 한곳에 둔다.

## 1. 현 실행기 계약

- **durable-first**: `commit_locked`가 writer(fsync) 완료 뒤에만 메모리 상태를 바꾸고, 이벤트는
  커밋이 반환된 뒤 발행한다. 저장 완료 전에 committed로 공개되는 경로는 없다.
- **FIFO 번호표**: `AppState::issue_mutation_publication()`이 발급하는 `MutationPublicationTicket`은
  발급 순서(= async 커맨드 future의 첫 poll 순서)대로 `ticket.run()` turn을 얻는다.
  앞 번호표가 **drop**돼야 다음 turn이 열린다 — 조기 return·패닉·취소 모두 Drop으로 반납된다.
- **turn 안에서만** store 반영과 이벤트 발행을 한다. turn 밖에서 `store.update`를 부르는 경로
  (트레이 설정, `overlay_set_*`, `sound_*`, `key_sound_set_output_backend`의 엔진 전환 등)는
  에디터 필드를 건드리지 않는 독립 필드에 한정하고, `ensure_generic_editor_unchanged`가 그 경계를 지킨다.
- 실행기 오류(`MUTATION_SHUTDOWN_STARTED`, `MUTATION_SEQUENCE_EXHAUSTED`)는 종료·패닉 시에만 난다.

## 2. 실행기 규칙 (위반 시 교착 또는 큐 정지)

1. **`ticket.run` 전에 Mutex/RwLock guard를 들지 말 것.** 뒤 번호표가 guard를 든 채 turn을
   기다리면 앞 번호표가 그 guard에서 막혀 순환한다. 카운터형 lease(`HistoryAdmissionLease`)만 허용.
   플러그인 authority는 이 이유로 값 타입 lease + turn 안 `revalidate`로 바꿨고, `plugin_authority_reset`은
   번호표를 타서 FIFO가 reset과 커밋을 직렬화한다.
2. **prepare 단계에 I/O를 두지 말 것.** `run_prepared_mutation`은 번호표를 prepare **전에** 발급하므로
   prepare의 파일·장치·네트워크 대기도 뒤 번호표의 대기 구간이다. 파일 읽기·복사·장치 열기는
   번호표 발급 전 `run_blocking`에서 끝내고 `issue_mutation_ticket` → `ticket.run(persist)` 순으로
   (선례: `js_load`, `js_reload`, `sound_load`, `sound_list`, `key_sound_set_output_backend`).
3. **잠금 순서**
   - 번호표 turn → plugin authority
   - 번호표 turn → `PROCESSED_WAV_TRANSACTION_LOCK` (sound)
   - 번호표 turn → CSS 잠금 (`css_load_from_path`)
   - `key_sound_output_persistence_lock` → 번호표 (유일한 예외: 번호표 보유자는 이 잠금을 잡지 않고
     fallback persist 스레드는 잠금만 잡는다 — `app_state.rs`의 필드 주석 참조)
4. turn 안에서 프론트 응답을 기다리지 말 것 (히스토리 flush 핸드셰이크는 번호표 밖에서 돈다).

## 3. 후속 과제

| 과제 | 내용 | 수용 기준 |
| --- | --- | --- |
| 잠금 밖 persist 대기 | `commit_locked`의 fsync를 store 잠금 밖으로 빼서 읽기 경로가 디스크를 기다리지 않게 | 키 입력 핫패스·트레이 읽기가 fsync 중 store read lock에서 대기하지 않음 (실측) |
| group commit | 연속 번호표의 writer 호출을 한 fsync로 병합 | 방향키 홀드 300 스텝 저장이 fsync 1~2회로 수렴, durable-first 유지 |
| plugin storage burst 상한 | `dmn.storage.set` 수백 건 동시 발사 시 blocking pool 스레드가 lease를 든 채 대기해 undo drain이 지연 | 세마포어 도입 시 대기 중 쓰기가 `HISTORY_IN_PROGRESS`로 유실되지 않도록 재시도 계약과 함께 |

## 4. 알려진 한계

- CSS 파일 불러오기는 번호표 turn 안에서 파일을 읽는다 — 사용자가 직접 불러오는 순간에 한정되므로 수용.
- plugin storage burst(위 표) — 세마포어 없이 두면 지연만 있고 유실은 없다. 상한을 두면 유실 범위가 넓어지므로 현재는 미조치.
- 히스토리 flush 핸드셰이크는 overlay ack까지 main mutation을 `HISTORY_IN_PROGRESS`로 차단한다(타임아웃 10s).
  숨겨진 overlay 웹뷰가 throttle되면 undo가 그만큼 늦어질 수 있어, 멈춤 증상이 보이면 소요시간 로깅부터.
