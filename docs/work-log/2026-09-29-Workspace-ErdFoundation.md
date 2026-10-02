# Workspace ERD 기본 설계 반영 결과

- 대상: ezerd 프로젝트 `903ec4ff-2ca4-4724-8d8a-3ec98765a68b`.
- 기존 물리 이름 `workspace`, `user_workspaces` 및 객체 ID 유지. 실제 운영 DB·서버 코드·마이그레이션은 변경하지 않았다.
- 공유 version/sequence 61 → 62. 공유 operationId `7a543c79-6b16-4dfd-965a-57f1d932fcb4`.
- 개인 결합 화면의 멤버 카드 크기만 확장했다. 개인 version 8 → 9, operationId `6b238a41-5982-48b7-94ac-35127e3ff11e`.

## 설계 변경

| 대상 | 반영 내용 |
| --- | --- |
| workspace | UUID DEFAULT gen_random_uuid(), created_at DEFAULT now(), updated_at timestamptz DEFAULT now(), status ENUM(active/archived) DEFAULT active |
| user_workspaces | 복합 PK(workspace_id, user_id), role ENUM(owner/editor/viewer) DEFAULT viewer, joined_at timestamptz DEFAULT now() |
| projects | workspace_id UUID NOT NULL FK → workspace.workspace_id, ON DELETE RESTRICT / ON UPDATE NO ACTION |
| 도메인 관계 | 인증 → 워크스페이스의 멤버 사용자, 워크스페이스 → 프로젝트의 공간 소속 관계 추가 |

- 멤버 FK 2개의 기존 NO ACTION 정책 유지.
- 워크스페이스 화면에 업무 규칙·참조·구현 범위 안내 메모 추가. 인증·프로젝트의 기존 참조 메모도 갱신했다.
- 마지막 owner 보호, 역할별 접근 제한, 보관 상태 처리, updated_at 수정 시 갱신은 ERD만으로 강제되지 않는 애플리케이션 규칙으로 명시했다.
- 사용자별 멤버 조회 및 공간별 프로젝트 조회 인덱스는 테이블 사용자 속성에 제안 DDL로 기록했다. 네이티브 인덱스 객체가 아니므로 현재 DDL 내보내기에서 자동 생성되지 않는다.
- 최종 객체 수: 도메인 5, 테이블 15, 컬럼 105, 키 20, 테이블 관계 21, 도메인 관계 7, 공유 메모 5.

## 검증

- MCP get_table_details 재조회로 새 컬럼·기본값·ENUM·복합 PK·FK 및 삭제 정책 확인.
- 전체 7개 화면을 get_project_view로 재조회했고 pagination은 모두 종료됐다. 모든 카드 쌍이 최소 40px 간격을 충족했다.
- 카드 크기는 실제 tableCardMetrics로 계산했다. 새 컬럼을 추가한 projects의 기존 카드 크기는 이미 충분하여 유지했다.
- list_view_relations로 새 도메인 관계 및 결합 화면의 workspace 관련 FK 표시 확인.
- diagnose_project 및 로컬 diagnoseDocument: 오류 없음.
- 신규 workspace 설계와 필요한 부모 키/프로젝트 FK만 추린 검증용 문서를 exportPostgres로 검증했다. canExport=true, 진단 0건이며 역할 ENUM, 복합 PK, projects FK의 RESTRICT가 DDL에 반영됐다. 실제 DB 실행은 수행하지 않았다.

## 기존 전체 DDL 내보내기 제한

전체 문서 exportPostgres는 아래 기존 JSONB 기본값 3건에서 unsupported-default 진단을 반환한다. 이번 변경 대상이 아닌 기존 값은 수정하지 않았다.

- review_messages.mention_ids
- project_personal_states.state
- projects.document

따라서 이번 workspace 설계의 DDL 생성 검증은 통과했으나 전체 프로젝트의 DDL 내보내기가 성공한 것으로 간주하지 않는다.
