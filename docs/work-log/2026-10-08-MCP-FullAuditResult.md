# MCP 전체 도구·v2 계약 점검 결과

- [계획](../planning/2026-10-07-MCP-FullAuditPlan.md)에 따라 실제 tools/list에 등록된 **42개 도구 전체**를 입력·출력·설명·annotations·handler 연결·권한·버전 처리 기준으로 대조했다.
- 기본 MCP 등록·토큰·보안 테스트와 실제 HTTP MCP/격리 DB 테스트를 함께 사용했다. 실제 사용자 프로젝트·DB·서버 실행 상태·배포·docs/EZERD.txt는 변경하지 않았다.

## 수정한 문제

| 문제 | 수정 및 검증 | 기록 |
| --- | --- | --- |
| 잘못된 취소 입력의 ZodError가 INTERNAL 오류로 숨겨짐 | 원문을 서비스 safeParse로 전달하고 HTTP 400/code/issues/path 반환. 입력 실패는 DB transaction을 호출하지 않음 | [취소 검증](2026-10-07-MCP-CancellationValidationResult.md), 커밋 2a9bf62 |
| 정상 v1 취소 ACK에 없는 protocolVersion을 MCP outputSchema가 요구함 | v1/v2 전체 계약 검증을 유지하면서 SDK guard의 잘못된 요구를 제거. 실제 v1 ledger에서 raw actor 문자열과 ACK 보존, 마커 미생성 확인 | [과거 ACK](2026-10-07-MCP-HistoricalCancellationAckResult.md), 커밋 29cd613 |
| 가져오기 형식·Native 수식·문서/이력/취소 내부 구조가 선언에서 불충분하게 노출됨 | 공통 계약의 상세 JSON Schema를 제공하고 원문 parser와 분리. 반복 구조·재귀 AST는 root definitions/ref로 표현하며 모든 input/output schema를 실제 SDK로 검증 | [상세 metadata](2026-10-08-MCP-NativeMetadataResult.md) |
| update_project의 DB 설명이 Native 변환까지 가능한 것처럼 읽힘 | Native v2 DB 변경은 기존 DB 변환 흐름을 사용해야 함을 명시. 서비스 정책과 지원 기능은 변경하지 않음 | 상세 metadata 단위에 포함 |

앞선 테이블 생성 요청의 namespace/placement 오류 및 일반 Bad Request Exception 응답 수정은 [이전 결과](2026-10-07-MCP-NativeCommandValidationResult.md), 커밋 2532020에 기록돼 있다.

## 등록된 42개 도구의 점검 범위

아래 목록은 도구의 실행 성공 한 번만 확인했다는 뜻이 아니다. 전체 등록·스키마·annotations·actor 연결을 대조하고 각 기능에 대응하는 기존 및 새 HTTP MCP 테스트와 서비스 정책 테스트를 확인했다. 가능한 모든 입력 조합을 증명하지는 않는다.

| 그룹 | 도구 | 확인한 경계 |
| --- | --- | --- |
| 사용자·공간·멤버·초대 16개 | whoami, create_workspace, list_workspaces, get_workspace, update_workspace, delete_workspace, list_workspace_members, update_workspace_member, remove_workspace_member, leave_workspace, create_workspace_invitation, list_workspace_invitations, list_my_workspace_invitations, accept_workspace_invitation, decline_workspace_invitation, cancel_workspace_invitation | 토큰 actor 고정, 멤버십·owner/viewer, 마지막 owner, 초대 대상, 보관 상태, 폐기된 토큰 및 멤버십 회수 |
| 프로젝트 수명주기·파일 6개 | list_projects, create_project, import_project, export_project, update_project, delete_project | 공간/role, 안정된 cursor, Native 기본 생성, v1→v2 및 v2 파일 재가져오기, CAS·보관 후 삭제·원문 provenance/rollback |
| 설계 읽기·DB·DDL 3개 | get_project_document_state, get_project_database_capabilities, export_project_ddl | 같은 snapshot의 source와 별도 preview, DB/profile/revision 문맥, usable와 supportedByEngine 구분, 전체 물리 설계 DDL, legacy/unsupported 진단 |
| 공유 설계 2개 | upgrade_project_document, apply_native_project_changes | 원본 v1 명시 upgrade, 3개 DB Native 변경, strict 명령·AST·옵션/제약 정책, shared/private 경계, legacy 원문 보존, 원자성·권한·잠금·동일 operation replay |
| 개인 상태 2개 | get_personal_state, apply_personal_changes | 자신의 개인 상태만 사용, viewer 허용, 개인 version과 Native 문맥 CAS, 공유 문서 불변, 잘못된 개인 참조·중복/재생 |
| 리뷰 6개 | list_review_threads, get_review_thread, create_review_thread, reply_review_thread, update_review_thread, delete_review_thread | Native 대상/뷰, 실제 author, mentions와 페이지 조회, 해결 상태, expectedUpdatedAt 삭제, 보관·권한 |
| 알림 2개 | list_notifications, update_notification | 자신의 알림만 조회·변경, unread 조건, 다른 사용자의 알림 변경 거부 |
| 이력·baseline·취소 5개 | get_native_project_baseline, get_native_project_history, undo_native_project_operation, restore_native_project_deletion, cancel_native_project_request | baseline은 발급 쓰기, 자신의 accepted Native 보상, 현재 문맥/충돌/복구 ID, legacy/upgrade 경계, 취소 종류 5개·fingerprint·늦은 쓰기 방지·기록된 v1/v2 ACK 보존 |

## 실행 검증

- 실제 tools/list의 모든 42개 input JSON Schema를 AJV로 컴파일했다. outputSchema는 MCP Client가 목록 조회 시 validator를 생성하며 실제 응답도 검사한다. 각 도구의 readOnlyHint/destructiveHint와 openWorldHint:false를 확인했다.
- 폐기한 v1 전용 도구 12개가 등록되지 않고 호출도 실패하는 기존 회귀 검증이 유지된다. get_project_view의 과거 클라이언트 목록과 현 등록 목록은 다르다.
- 새 발견 테스트는 v1/compact v2/versioned v2 가져오기, 재귀 수식과 잘못된 literal 값, 종류별 취소 identity와 history sourceOperationId 요구, __proto__ 원문 보존, 문서/이력의 출력 구조를 확인한다.
- 새 HTTP MCP 흐름은 PostgreSQL/MySQL/SQLite에서 tools/list 후 생성·편집·DDL·파일 export·리뷰 전체 수명주기·알림·개인 상태·이력·프로젝트 보관/삭제를 수행했다. 문서·ACK 출력이 클라이언트 검증을 통과하며 개인 상태는 공유 원본을 바꾸지 않는다.
- 최종 **pnpm check** 통과: format:check, typecheck, test, build. 전체 기본 테스트는 **205개 파일 / 2,592개 테스트 통과**, 25개 파일 / 496개 테스트 건너뜀. 저장 타입 등 동시 진행 작업도 있는 검증 당시 레포 전체 기준이다.
- 최종 격리 DB의 **17개 스위트 / 345개 테스트 모두 통과**. test-isolated.ts가 임시 DB 생성·마이그레이션·정리를 수행했다.
- 실행한 스위트: mcp.integration, versioned-document.integration, native-history.integration, native-cancellation.integration, native-transfer.integration, native-transfer-legacy.integration, native-canvas-decoration.integration, native-clipboard.integration, native-deferrable-patch.integration, native-expression-policy.integration, native-option-policy.integration, native-ddl.integration, native-catalog-path.integration, native-feature-path.integration, native-conversion-websocket.integration, native-replay-access.integration, native-upgrade-replay.integration.
- git diff --check 통과. 기존 Vite 500kB 청크 경고와 격리 실행기의 shell:true deprecation 경고는 남는다. 브라우저 수동 QA나 MySQL/SQLite 서버를 별도로 실행한 DDL 실행 검증은 이번에 추가하지 않았다.

## 현재 한계와 적용

- **Native DB 종류 변경의 preview/apply 도구는 MCP에 등록돼 있지 않다.** 기존 ProjectDatabaseService/웹·REST의 변환 흐름이 담당한다. update_project의 databaseKind로 Native 문서를 재해석하거나 우회하지 않도록 설명을 고쳤다. 새 MCP 기능을 추가하는 작업은 이번 등록 도구 감사와 구분한다.
- JSON Schema는 구조·필수 필드·기본 한도를 설명한다. AST 깊이/노드 수, 권한, 프로젝트 참조, DB 기능 readiness, legacy provenance, 동시성·replay 정책은 실제 서버 validator가 계속 판단한다. 과거 취소 request에는 현재의 명령 전체 스키마를 강제하지 않는다.
- 동시 진행 중인 v1 QA 제거·회귀 실행기 등 변경은 MCP 커밋에 포함하지 않았다.
- 로컬 소스와 빌드·격리 환경 검증을 완료했으며 실행 중인 사용자 서버를 재시작하거나 배포하지 않았다. 실제 사용에는 최신 서버 실행본과 새 도구 목록을 받는 MCP 재연결이 필요하다.
