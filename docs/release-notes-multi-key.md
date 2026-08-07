# 멀티 키 매핑 릴리스 노트 초안

상태: **초안**. 외부 노출 카피이므로 릴리스 시 유저 승인 후 실제 릴리스 노트에 반영한다.
근거: 멀티 키 매핑 내부 계약 v4의 다운그레이드 안내·플러그인 체인지로그 요구 (내부 작업 문서, 저장소 미추적).

## 한국어 초안

### 새 기능

- 한 슬롯에 여러 키를 매핑할 수 있습니다. 개별(any)은 멤버 키 중 하나만 눌러도, 동시(all)는 전부 함께 눌러야 반응합니다.

### 이전 버전으로 되돌릴 때 (다운그레이드 안내)

- 멀티 키 슬롯이 저장된 상태에서 이전 버전을 실행하면 해당 슬롯은 빈 슬롯으로 표시됩니다 (키 배치와 순서는 유지).
- 이전 버전이 처음 실행될 때 원본 설정 파일이 `store.json.bak`으로 자동 보존됩니다 (앱 데이터 폴더).
- 복원 방법: 다시 새 버전으로 업데이트한 뒤, 앱을 종료한 상태에서 `store.json.bak`을 `store.json`으로 되돌리면 멀티 키 슬롯이 복구됩니다. 이후 다른 복구가 겹쳐 `store.json.bak`이 갱신된 경우에는 최초 원본을 보존하는 `store.json.pre-migration.bak`을 사용하세요.

### OBS 오버레이 사용자

- 업데이트 후 이미 열려 있던 OBS 브라우저 소스는 연결이 거부됩니다 (프로토콜 v2). 브라우저 소스를 새로고침하거나 OBS를 재시작하면 정상 동작합니다.

### 플러그인 개발자

- `dmn.keys.get()` 등 키 매핑을 읽는 모든 표면(`app.bootstrap`, `editor.get`, 프리셋 스냅샷 포함)이 이제 문자열 또는 멀티 키 객체(`KeySlot` union)를 전달합니다. 슬롯을 순수 문자열로 가정하는 플러그인은 업데이트가 필요합니다.
- 현재 매핑에 멀티 키 슬롯이 있으면 `keys` 쓰기에 `multiKey: true` 선언이 필요합니다. 선언 없는 쓰기는 `MULTI_KEY_UNSUPPORTED`로 거절됩니다 (사용자 설정 보호).
- 이벤트·카운터 표면은 canonical 식별자(단일 키는 그대로, all은 `+` 조인, any는 `|` 조인)를 사용합니다. 자세한 내용은 Keys API 문서의 "canonical 슬롯 식별자" 절 참고.

## English draft

### New

- A single slot can now bind multiple keys. An `any` slot activates when any member key is pressed; an `all` slot activates while all member keys are held together.

### Rolling back to an older version (downgrade notes)

- If multi-key slots are saved and you run an older version, those slots appear as unassigned (key layout and order are preserved).
- On its first launch the older version automatically preserves your original settings file as `store.json.bak` in the app data folder.
- To restore: update back to the new version, quit the app, and replace `store.json` with `store.json.bak`. Your multi-key slots will be recovered. If a later repair has since refreshed `store.json.bak`, use `store.json.pre-migration.bak`, which preserves the first original.

### OBS overlay users

- Browser sources that were already open before the update are rejected by the new app (protocol v2). Refresh the browser source or restart OBS to reconnect.

### Plugin developers

- Every surface that reads key mappings (`dmn.keys.get()`, `app.bootstrap`, `editor.get`, preset snapshots) now carries the `KeySlot` union (`string | MultiKeySlot`). Plugins that assume plain string slots need an update.
- Writing `keys` while the current mappings contain a multi-key slot requires declaring `multiKey: true`; undeclared writes are rejected with `MULTI_KEY_UNSUPPORTED` to protect user configurations.
- Event and counter surfaces use canonical identifiers (single keys unchanged, `all` joined with `+`, `any` joined with `|`). See the "Canonical slot identifiers" section of the Keys API docs.
