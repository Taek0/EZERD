# 기존 로컬 DB 마이그레이션 결과

## 적용

- 연결 대상이 로컬 PostgreSQL임을 확인하고 `0013`까지 적용된 상태에서 `0014_database_context`를 반영했다.
- 프로젝트 DB profile/revision, sync baseline revision 및 project_database_operations 테이블이 추가됐다. 프로젝트 3개의 프로필은 postgresql-18-v1, revision은 0으로 설정됐다.
- 기존 JSON 설계 문서 schemaVersion 1은 그대로 유지했다. 인증·이력·리비전 검증을 거치는 별도 네이티브 업그레이드 API를 우회한 데이터 변환은 하지 않았다.

## 백업 및 복원 예행연습

- 백업: `.data/backups/2026-10-02-pre-migration-1790921218511/ezerd.dump` (6,155,056 bytes, pg_dump custom 형식).
- pg_restore 목록 검사 후 임시 로컬 DB에 실제 복원하고 마이그레이션 적용을 검증했다. 예행연습 DB는 제거했다.
- 같은 백업 폴더에 before.json, rehearsal.json, after.json, compatibility.json을 저장했다. 이 폴더는 Git 제외 대상이며 백업 원문을 커밋하거나 외부에 전송하지 않았다.

## 데이터 보존 검증

- 적용 전후 기존 public 테이블 17개의 건수와 모든 기존 컬럼 내용을 대상으로 계산한 행 집계 해시가 일치했다. 새로 추가한 필드만 비교에서 제외했다.
- 프로젝트 3개, 워크스페이스 2개, 사용자 2개, 멤버십 2개, 핀 1개, 댓글 4개 및 동기화/개인 상태/인증 자료를 보존했다.
- 신규 project_database_operations 테이블은 0행이다.
- `pnpm db:migrate`, 최신 DatabaseService.checkReady, `pnpm db:check`의 INSERT/SELECT/ROLLBACK, `pnpm build` 모두 통과했다. SQL 마이그레이션 오류는 없었다. 빌드에는 기존 대형 청크 경고만 남는다.

## 설계 문서 호환성 진단

- 실제 프로젝트 원본을 최신 readNativeProjectDocument로 읽은 결과 세 프로젝트 모두 available이다. v2 업그레이드 후보의 계약 검사와 이전 문서 보존을 허용하는 쓰기 검사도 통과했다. 후보는 메모리에서만 만들었다.
- ezerd: 미해석 항목 0개.
- klassboard-backend: 기본값 미해석 12개. uuid_generate_v4() 8개는 현재 자동 변환 함수 목록에 없고, GENERATED ALWAYS AS ... STORED 식 4개는 기존 defaultExpression에 저장돼 있어 생성 컬럼 구조로 자동 추론하지 않는다.
  - UUID 함수: tbl_enterprise_inquiry.inquiryId, tbl_workspace_student_identity_history.history_id, tbl_workspace_ownership_transfers.ownershipTransferId, tbl_workspace_invitations.invitation_id, tbl_workspace_memberships.membership_id, tbl_workspace_code_registrations.registrationId, tbl_workspaces.workspace_id, tbl_workspace_attendees.attendee_id.
  - 생성 식: tbl_workspace_memberships.teacher_account_id, tbl_workspace_memberships.administrator_account_id, commerce_subscription_responsibilities.recurring_subscription_id, commerce_subscription_responsibilities.fixed_term_subscription_id.
- monya: contents.content_type의 타입명이 빈 문자열이므로 미해석 타입 1개.
- 위 항목은 DB 마이그레이션 실패가 아니라 기존 설계의 자동 해석 한계다. 원문을 legacy 상태로 보존하며, 네이티브 편집/DDL 준비 시 명시적으로 정리해야 한다. 타입이나 생성 식을 임의로 변경하지 않았다.
- 임시 점검 스크립트는 제거했다. 서비스 재시작이나 실제 프로젝트 네이티브 업그레이드는 수행하지 않았다.
