---
name: codex-review
description: "작업 완료 후 Codex(GPT 5.4)를 활용한 코드 리뷰. 변경사항 리뷰, 코드 품질 검토 시 사용."
disable-model-invocation: false
argument-hint: "[리뷰 초점 (선택)]"
---

# 코드 리뷰 - Codex(GPT 5.4)

Claude가 변경사항을 경량 분석한 뒤, Codex(GPT 5.4)에게 검증/심층 리뷰를 받습니다.
Codex는 `danger-full-access` 권한으로 직접 파일 읽기, 쉘 명령 실행이 가능합니다.

## 절차

1. Claude가 `git diff --stat`으로 변경 범위를 파악합니다.
2. 핵심 변경 파일을 Read로 확인하고 **diff 요약, 의도 추정, 위험 포인트**를 정리합니다.
3. Claude의 선분석 결과를 Codex에게 전달하여 검증/심층 리뷰를 요청합니다 (백그라운드).
4. 진행 상황을 주기적으로 확인하여 사용자에게 보고합니다.
5. 필요시 `codex exec resume --last`로 심화 리뷰합니다.
6. Codex 피드백을 종합하여 최종 리뷰 결과를 보고합니다.

## Codex 호출 방법

### 리뷰 요청
Claude의 선분석 결과를 프롬프트에 포함하여 검증을 요청합니다.
```bash
codex exec -C "$(pwd)" -s danger-full-access --json "다음은 Claude(Opus)가 작성한 코드 리뷰 선분석입니다. 검증하고 심층 리뷰해주세요.

git diff와 git diff --cached를 직접 실행하여 변경사항을 확인하고,
필요하면 관련 파일의 전체 컨텍스트도 읽어주세요.

Claude 선분석:
(diff 요약, 의도 추정, 위험 포인트)

검증해줄 사항:
- Claude가 놓친 이슈가 있는지
- 타입 안정성, 네이밍 컨벤션 준수 여부
- React Compiler 호환성 (useSignals 시 'use no memo' 필수)
- 불필요한 리렌더링 패턴
- 보안 취약점
- 테스트 영향 및 회귀 가능성

리뷰 초점: (사용자 인자 또는 전반적 리뷰)

한글로 간결하게 답변해주세요." 2>/dev/null
```

### 브랜치 대비 리뷰
브랜치 전체 변경사항을 리뷰할 때는 프롬프트에 브랜치명을 명시합니다.
```bash
codex exec -C "$(pwd)" -s danger-full-access --json "이 프로젝트에서 master 브랜치 대비 현재 브랜치의 전체 변경사항을 코드 리뷰해주세요.
git diff master...HEAD를 실행하여 변경사항을 직접 확인하고,
필요하면 관련 파일의 전체 컨텍스트도 읽어주세요.
..." 2>/dev/null
```

### 진행 상황 확인
백그라운드 실행 중 TaskOutput으로 중간 출력을 확인합니다.
JSONL 이벤트 타입으로 진행 상태를 판단합니다:
- `thread.started` → 세션 시작됨
- `item.completed` + `"type":"tool_call"` → Codex가 도구 호출 중
- `item.completed` + `"type":"agent_message"` → 응답 생성됨
- `turn.completed` → 턴 완료

### 후속 질문
```bash
codex exec resume --last "해당 이슈에 대한 구체적인 수정 코드를 제안해주세요"
```

### 호출 규칙
- `-C "$(pwd)"`, `-s danger-full-access`, `--json` 기본 적용.
- `--ephemeral`은 사용하지 않습니다 (후속 resume 보존).
- Bash의 `run_in_background: true`로 실행합니다. 백그라운드이므로 즉시 반환되며, Codex 작업은 완료까지 제한 없이 계속됩니다.
- 완료 시 시스템이 자동 알림 → TaskOutput으로 결과를 수집합니다.

## 실패 처리

- `codex exec` 실패 시:
  → "Codex 호출 실패: [에러 내용]. Claude가 직접 리뷰합니다."를 보고
  → Claude가 직접 diff를 읽어 리뷰합니다.
- fallback 발생 시 반드시 원인을 사용자에게 명시합니다.

## 출력 형식

### 리뷰 요약
(전체 코드 품질 평가 한 줄. fallback인 경우 "[Codex 미사용: 사유]" 명시)

### 이슈 목록
- **[Critical]** 파일:라인 - 설명 및 근거
- **[Warning]** 파일:라인 - 설명 및 근거
- **[Suggestion]** 파일:라인 - 설명 및 근거

### 개선 제안
(구체적 코드 수정 제안 - before/after 코드 블록 포함)
