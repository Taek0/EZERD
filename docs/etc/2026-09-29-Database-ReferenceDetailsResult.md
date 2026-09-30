# 도메인별 참조 상세 표기 결과

- 프로젝트: `ezerd` (`903ec4ff-2ca4-4724-8d8a-3ec98765a68b`).
- 개요의 도메인 관계 5개를 실제 역할명과 FK 목록으로 구체화했다.
- 실제 FK 18개의 논리 이름·설명과 대응 컬럼 18개의 논리 정의를 보완했다.
- 각 도메인 화면 아래에 참조 상세 메모 1개씩 추가했다. 전체 테이블 결합 화면에서는 관계선 툴팁·관계 상세에 같은 설명이 표시된다.
- 작업 중 사용자 배치 변경으로 공유 버전이 9 → 17로 갱신된 것을 확인하여 최신 화면을 재조회한 뒤 version 17 / sequence 17 기준으로 적용했다. 승인된 작업 sequence는 18이다.
- 공유 작업 operationId: `8913e2d6-fd45-4f99-97c8-0fc234d2b8ab`.

## 공통 규칙

- 아래 화살표는 자식 FK → 부모 PK 방향이다. 개요의 도메인 화살표는 부모 도메인 → 이를 참조하는 도메인이다.
- 모든 실제 FK는 UUID NOT NULL이며 자식 한 행은 부모 한 행을 반드시 참조한다. 부모는 자식 0..N행을 가질 수 있다.
- ON UPDATE는 모두 NO ACTION이다. 참조 중인 부모 키 변경을 자동 전파하지 않는다.
- CASCADE는 해당 부모 행 삭제에 따라 해당 자식 행도 삭제되는 규칙이다. 다른 NO ACTION FK가 남아 있으면 부모 삭제 전체가 거부될 수 있다.

## 인증

| 참조 컬럼 → 대상 PK | 용도 | ON DELETE |
| --- | --- | --- |
| `sessions.user_id → users.id` | 로그인 세션을 발급받은 사용자 | CASCADE |
| `mcp_tokens.user_id → users.id` | MCP 접근 토큰을 발급받은 사용자 | CASCADE |

## 프로젝트

| 참조 컬럼 → 대상 PK | 용도 | ON DELETE |
| --- | --- | --- |
| `project_personal_states.project_id → projects.id` | 개인 화면 상태가 적용되는 프로젝트 | CASCADE |
| `project_personal_states.user_id → users.id` | 결합 화면·개인 배치·메모를 소유하는 사용자 | CASCADE |
| `project_personal_operations.project_id → projects.id` | 개인 변경 요청과 재시도 결과가 속한 프로젝트 | CASCADE |
| `project_personal_operations.user_id → users.id` | 개인 변경을 요청한 사용자 | CASCADE |

## 리뷰

| 참조 컬럼 → 대상 PK | 용도 | ON DELETE |
| --- | --- | --- |
| `review_threads.project_id → projects.id` | 리뷰 스레드가 생성된 프로젝트 | CASCADE |
| `review_messages.thread_id → review_threads.id` | 메시지가 속한 리뷰 스레드 | CASCADE |
| `review_messages.author_id → users.id` | 리뷰 메시지를 작성한 사용자 | NO ACTION |
| `review_notifications.user_id → users.id` | 리뷰 알림을 받는 사용자 | CASCADE |
| `review_notifications.project_id → projects.id` | 알림이 안내하는 프로젝트 | CASCADE |
| `review_notifications.thread_id → review_threads.id` | 알림을 통해 이동할 리뷰 스레드 | CASCADE |

## 동기화

| 참조 컬럼 → 대상 PK | 용도 | ON DELETE |
| --- | --- | --- |
| `sync_operations.project_id → projects.id` | 공유 설계 변경 이력이 기록된 프로젝트 | CASCADE |
| `sync_operations.actor_id → users.id` | 공유 설계 변경을 수행한 사용자 | NO ACTION |
| `sync_field_versions.project_id → projects.id` | 문서 필드 경로별 마지막 변경 버전을 관리하는 프로젝트 | CASCADE |
| `sync_client_baselines.project_id → projects.id` | 클라이언트의 동기화 기준 문서가 속한 프로젝트 | CASCADE |
| `sync_client_baselines.user_id → users.id` | 클라이언트 동기화 기준과 연결된 사용자 | CASCADE |
| `sync_tombstones.project_id → projects.id` | 삭제된 설계 객체의 복구 스냅샷이 속한 프로젝트 | CASCADE |

## FK와 구분할 사항

- `project_personal_states`의 PK는 `(project_id, user_id)`이므로 한 프로젝트·사용자 조합에 상태는 한 행이다.
- `projects.document`의 도메인·테이블·컬럼 ID는 JSONB 내부 식별자이며 별도 물리 테이블의 FK가 아니다.
- `review_threads.view_id`, `object_id`는 설계 문서 대상 식별자이다. `review_messages.mention_ids`는 서비스에서 사용자 존재를 검증하는 JSONB 배열이며 DB FK는 없다.
- `review_notifications.project_id`와 `thread_id`는 독립 FK이므로 두 대상이 같은 프로젝트인지까지 복합 FK로 강제하지 않는다.
- 동기화의 `operation_id`, `baseline_id`, `client_id` 사이에 추가 FK는 정의되어 있지 않다. `sync_field_versions.path`, `sync_tombstones.object_id`도 DB FK가 아니다.

## 검증

- MCP 저장 응답의 도메인 관계 5개 이름·설명이 요청과 일치했다.
- 13개 테이블을 `get_table_details`로 재조회하여 18개 관계와 컬럼 설명을 검증했다. 테이블 정의·물리 컬럼 속성·키·실제 FK 속성은 변경 전과 일치했다.
- 6개 화면 전체 페이지를 `get_project_view`로 재조회했다. 메모 4개의 내용 일치, 카드 쌍 간 최소 40px 간격, 메모와 카드 겹침 없음 확인.
- `diagnose_project`: 오류 없음.
- 애플리케이션 코드 및 `docs/EZERD.txt` 변경 없음. 작업 파일은 문서만이며 Prettier 제외 대상이다.
