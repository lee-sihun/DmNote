---
name: plan
description: "작업 전 Codex(GPT 5.4)와 협업하여 구현 계획을 수립. 작업 계획, 설계 논의, 접근 방식 검토 시 사용."
disable-model-invocation: false
argument-hint: "[작업 설명]"
---

# 작업 계획 수립 - Codex(GPT 5.4) 협업

Claude가 코드를 분석하고 초안 계획을 작성한 뒤, Codex(GPT 5.4)에게 검증/보완을 받습니다.
대규모 아키텍처 변경이나 고위험 작업은 병렬 분석 모드로 전환합니다.

## 모드 선택

### 기본 모드 (B: 순차 협업)
대부분의 작업에 사용합니다.
1. Claude가 Read, Grep, Glob으로 관련 코드를 분석합니다.
2. 코드 구조, 영향 범위, 초안 계획을 정리합니다.
3. 분석 결과를 Codex에게 전달하여 검증/보완을 요청합니다.
4. Codex 피드백을 반영하여 최종 계획을 확정합니다.

### 병렬 모드 (C: 독립 분석)
다음 조건에 해당하면 병렬 모드를 사용합니다:
- 변경 범위가 크고 아키텍처 영향이 넓을 때
- Rust 백엔드와 React 프론트가 강하게 얽혀 있을 때
- 실패 비용이 큰 리팩토링/마이그레이션일 때

1. Claude 분석과 Codex 분석을 동시에 진행합니다.
   - Claude: Read, Grep, Glob으로 코드 분석
   - Codex: `codex exec`로 독립적 분석 (백그라운드)
2. 두 분석 결과를 종합하여 최종 계획을 작성합니다.

## Codex 호출 방법

### 기본 모드 프롬프트
Claude의 분석 결과를 프롬프트에 포함하여 검증을 요청합니다.
```bash
codex exec -C "$(pwd)" -s danger-full-access --json "다음은 Claude(Opus)가 작성한 구현 계획 초안입니다. 검증하고 보완해주세요.

프로젝트 기술 스택: Tauri(Rust + React), Zustand, Preact Signals, Tailwind CSS, Vite
필요하면 관련 파일을 직접 읽어서 확인해주세요.

작업 내용: (사용자 요청)

Claude 분석 결과:
(코드 구조, 영향 범위, 초안 계획)

검증해줄 사항:
- 누락된 영향 범위나 리스크가 있는지
- 더 나은 접근 방식이 있는지
- 초안 계획의 순서나 우선순위가 적절한지

한글로 간결하게 답변해주세요." 2>/dev/null
```

### 병렬 모드 프롬프트
Codex가 독립적으로 분석하도록 지시합니다.
```bash
codex exec -C "$(pwd)" -s danger-full-access --json "다음 작업에 대한 구현 계획을 독립적으로 분석해주세요.

프로젝트 기술 스택: Tauri(Rust + React), Zustand, Preact Signals, Tailwind CSS, Vite
관련 파일을 직접 읽어서 코드 구조를 파악해주세요.

작업 내용: (사용자 요청)

분석해줄 사항:
- 코드 구조 및 영향 범위
- 구현 접근 방식 제안
- 잠재적 리스크

한글로 간결하게 답변해주세요." 2>/dev/null
```

### 공통 규칙
- `-C "$(pwd)"`, `-s danger-full-access`, `--json` 기본 적용.
- `--ephemeral`은 사용하지 않습니다 (후속 resume 보존).
- Bash의 `run_in_background: true`로 실행합니다. 백그라운드이므로 즉시 반환되며, Codex 작업은 완료까지 제한 없이 계속됩니다.
- 완료 시 시스템이 자동 알림 → TaskOutput으로 결과를 수집합니다.
- **중요: 결론을 내리기 전에 반드시 `TaskOutput(block: false)`로 Codex 상태를 확인합니다.**
  - `status: running` → Codex가 작업 중이므로 대기. 대기 중에는 Claude 선분석 등 병렬 가능한 작업만 수행.
  - `status: completed` → 결과를 수집하여 반영.
  - `status: failed` 또는 에러 → 즉시 fallback (Claude 단독 진행). 대기하지 않음.

### 진행 상황 확인
백그라운드 실행 중 TaskOutput으로 중간 출력을 확인합니다.
JSONL 이벤트 타입으로 진행 상태를 판단합니다:
- `thread.started` → 세션 시작됨
- `item.completed` + `"type":"tool_call"` → Codex가 도구 호출 중
- `item.completed` + `"type":"agent_message"` → 응답 생성됨
- `turn.completed` → 턴 완료

### 후속 질문 (멀티턴)
```bash
codex exec resume --last "추가 질문"
```

## 실패 처리

- `codex exec` 실패 시:
  → "Codex 호출 실패: [에러 내용]. Claude 단독으로 계획을 수립합니다."
  → Claude 단독으로 계획을 수립합니다.
- Codex 응답이 불충분하면 resume으로 한 번 더 질문하되, 2회 이상 실패 시 포기합니다.
- fallback 발생 시 반드시 사용자에게 원인을 명시합니다.

## 출력 형식

### Claude 분석
(코드 구조, 영향 범위, 기존 패턴)

### Codex(GPT 5.4) 피드백
(검증 결과 및 보완 사항. fallback인 경우 "[Codex 미사용: 사유]" 명시)

### 최종 실행 계획
1. (구체적 단계별 작업 - 파일명과 변경 내용 포함)

### 제약사항 및 리스크
(양쪽에서 지적된 주의점)
