# 관계선 자동 정렬 Worker·저장 통합

## 구현

- 명시적 사용자 실행에서만 Web Worker를 만들고 작업 ID로 진행·결과를 구분한다. 취소, 화면 이탈, 구조·크기 변경 때 Worker를 종료하며 늦게 도착한 결과를 무시한다.
- 현재 화면의 전체 노드와 관계를 DTO로 준비하고, 완료 시 최신 배치 입력을 검증한다. 테이블·메모 위치만 바뀌었다면 기존 경로 기하 처리로 한 번 보정한다.
- 변경된 관계 경로를 하나의 `batch_upsert_relation_layouts` 명령으로 저장한다. 로컬 저장 intent의 관계 경로 projection과 ACK bridge를 통해 서버 응답 전에도 배치를 한 번에 표시한다.
- 서버가 명시적으로 거절하고 최신 문서가 확인된 경우에만 구조·경로 충돌을 검사하고 한 번 재시도한다. 통신 미확정 요청은 기존 durable queue에서 같은 operation ID로 복구한다.
- 저장 중 취소는 원래 operation ID를 서버 취소 프로토콜로 확인한다. 확정 후 실행 취소는 해당 batch operation의 native history undo를 사용하므로 이전에 경로 레코드가 없었던 관계도 복원할 수 있다.

## 검증

- `pnpm --filter @ezerd/web typecheck`
- `pnpm exec vitest run apps/web/src/features/projects/native-relation-auto-arrange.test.ts apps/web/src/features/projects/native-save-intents.test.ts` — 18개 통과. 구조 변경 직후의 늦은 Worker 결과, 위치 이동 보정, 원격 경로 충돌, 단일 재시도와 새 operation ID, 배치 상한, 저장 전 취소의 원래 ID 사용을 확인했다.
