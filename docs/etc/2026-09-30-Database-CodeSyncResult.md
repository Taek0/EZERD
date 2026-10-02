# 수정 코드 기반 ERD 동기화 결과

- 대상: ezerd MCP 프로젝트 `903ec4ff-2ca4-4724-8d8a-3ec98765a68b`.
- 기준: 코드 HEAD `6d4e797`, `apps/server/src/db/schema.ts`, `apps/server/drizzle/meta/0012_snapshot.json`, workspace 서비스 및 권한 코드.
- 애플리케이션 코드 및 실제 DB를 변경하지 않고 MCP 설계 문서와 개인 결합 화면만 변경했다.

## 반영 내용

- `workspace_invitations` 추가: 9개 컬럼, PK, 공간·초대 수신자·발신자 FK 3개. 공간 삭제 CASCADE, 사용자 삭제 NO ACTION. 역할은 workspace_role, 상태는 pending/accepted/declined/cancelled/expired ENUM.
- `workspace_audit_events` 추가: 7개 컬럼 및 PK. 공간/사용자 삭제 후 이력 보존 의도에 따라 workspace_id, actor_id, target_user_id에는 FK를 추가하지 않았다.
- 기존 역할 ENUM 객체 ID는 유지하고 물리 이름을 `workspace_member_role` → 실제 `workspace_role`로 정정했다.
- workspace 관련 PK·FK 이름, 실제 인덱스 및 CHECK 메타데이터를 최신 스키마에 맞췄다. 기존 ID와 다른 도메인의 배치는 보존했다.
- `workspace_invitations_pending_unique`는 `(workspace_id, invited_user_id) WHERE status = 'pending'`인 조건부 고유 인덱스다. 조건 없는 UNIQUE 키로 만들지 않고 조건까지 테이블 속성에 보존했다.
- 시간대 시각은 timestamptz로 정규화했다. JSONB 기본값의 값은 유지하면서 불필요한 ::jsonb 표기를 제거하여 현재 DDL 내보내기가 읽을 수 있는 리터럴로 정리했다.
- 설계 단계 메모를 코드 구현 기준으로 갱신했다. viewer도 활성 공간에서 리뷰·개인 상태 변경이 가능하며, 보관 공간의 프로젝트 쓰기는 제한된다. 마지막 owner 보호, 초대 유효기간 7일과 수락 시 기존 역할 보존, 감사 이력 유지 동작을 명시했다.
- 워크스페이스 공유 화면과 기존 전체 결합 화면에 새 테이블을 배치했다. 메모를 아래로 옮겨 겹침을 피했다.
- 최종 구조: 테이블 17, 컬럼 121, 키 22, 실제 FK 24, ENUM 4. 공유 version 66 / sequence 67, 개인 version 11.

## 검증

- MCP 재조회 문서를 입력 예정 문서와 객체별로 비교: 테이블·컬럼·키·FK·ENUM·메모·도메인 관계 모두 일치.
- 스키마 스냅샷과 17개 테이블/121개 컬럼의 타입·길이·NULL·기본값, FK 개수, 인덱스 메타데이터 비교: 불일치 없음.
- 모든 7개 화면의 전체 페이지 및 관계 목록 재조회. 전체 결합 화면에 테이블 17개와 관계 24개 표시 확인.
- 카드별 좌표 계산: 최소 40px 간격 충족. 소수 계산에 따른 감사 카드 폭 458.0000000000001px을 고려해 저장 폭은 459px로 올림했다.
- MCP diagnose_project 및 diagnose_layout: 진단 0건, 잘림 없음.
- 로컬 diagnoseDocument 및 exportPostgres: 모델 진단 0건, canExport=true, DDL 진단 0건.
- 단, 일반/조건부 인덱스와 CHECK는 기존 모델 제약상 사용자 속성으로 보존되며 자동 생성 DDL에 포함되지 않는다. DDL 생성 통과가 원본 스키마의 모든 인덱스까지 재현한다는 뜻은 아니다.

## 저장 중 발견한 서버 제한

- 최초 작업 `06180e39-ec95-45ac-83b2-75c2f0c7fa21`은 sequence 64에서 거부됐다. 기존 `review_notifications.created_at`의 null 기본값을 now()로 복구하는 변경이 객체 ID 재사용 검사에 걸렸다. 신규 객체 ID 충돌이 아니라 기존 scalar 경로에 대한 과도한 검사였다.
- 해당 기존 컬럼의 기본값을 동등한 빈 표현식으로 먼저 저장한 뒤 최종 now()로 반영하여 완료했다. 서버 코드 변경 없이 최종 스키마와 일치함을 재검증했다.
- 적용 작업: 기본값 처리 `897cd9e5-44a7-4993-a0ad-cec95fac6d01`(65), 본 변경 `c7b11772-76c4-4cc4-95cb-3dcf40a83cef`(66), 카드 폭 보정 `f2e88084-4c06-4820-b8ac-cd3b0faef081`(67).
- 개인 화면 작업: `a34b7f3a-1af3-4e6a-b05b-11ad22b90b36`, `55d887ce-8ee8-4228-83fd-ce76e8db08c1`.
