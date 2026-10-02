# 타입 정책 확인 및 Workspace 도입 설계

## 범위와 검토 기준

- 요청된 타입 변경의 실제 적용 범위를 코드, 기존 테스트, MCP 설계 데이터로 확인한다.
- `workspace`는 사용자들이 프로젝트를 함께 사용하는 소속·접근 권한 단위로 가정한다. 개인별 프로젝트 분류 폴더가 목적이면 별도 설계가 필요하다.
- 현재 MCP에 사용자가 만든 `workspace`, `user_workspaces`를 기준으로 제안한다. 이번 작업은 검토와 설계이며 ERD 및 운영 스키마를 변경하지 않는다.

## 타입 정책 제안

- 시간대가 있는 시각의 선택·표시는 `timestamptz`로 통일한다. 과거 `timestamp with time zone` 입력은 호환 별칭으로 허용하되 저장까지 통일하려면 API/MCP/가져오기 경계에서 별도 정규화가 필요하다.
- `timestamp`는 시간대 없는 다른 의미의 타입이므로 시간대 별칭 정리와 구분한다.
- `numeric(p,s)`의 p는 전체 유효 자릿수, s는 소수 자릿수다. `double precision`은 부동소수점으로 의미가 달라 별칭처럼 일괄 치환하지 않는다.
- 숫자 전체를 numeric으로 제한하는 정책인지, 편집기에 자릿수를 표시하는 정책인지 구분한다. 좌표를 고정 소수로 바꾼다면 허용 범위와 반올림 규칙을 먼저 정하고 실제 DB·Drizzle·API 직렬화·기존 데이터 변환을 함께 변경한다.

## 최소 Workspace 구조 제안

- 기존 `workspace` 테이블: `workspace_id uuid PK DEFAULT gen_random_uuid()`, `workspace_name varchar(64) NOT NULL`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- 필요하면 상태(active/archived)를 추가하고 삭제보다 보관을 우선한다. 이름 전역 UNIQUE는 요구사항이 없으므로 강제하지 않는다.
- 기존 `user_workspaces`: `(workspace_id, user_id)` 복합 PK, 두 FK, `role`(owner/editor/viewer), `joined_at timestamptz NOT NULL DEFAULT now()`. 역할은 NOT NULL 및 CHECK 또는 ENUM으로 제한한다. 사용자별 목록용 `(user_id, workspace_id)` 인덱스도 둔다.
- `projects.workspace_id uuid NOT NULL REFERENCES workspace(workspace_id)`와 workspace별 프로젝트 목록 조회 인덱스를 추가한다. 프로젝트는 한 workspace에 소속되는 것으로 시작한다.
- 기존 사용자 전역 식별자를 유지한다. 인증 세션·MCP 토큰은 사용자에 속하고 접근 시 workspace membership을 검증한다.
- 리뷰·동기화·개인 상태의 workspace는 project를 통해 판별한다. 초기에는 하위 테이블에 workspace_id를 중복 저장하지 않는다.
- 멤버 FK 삭제 정책은 현재 NO ACTION에서 자동 변경하지 않는다. 사용자 삭제와 마지막 owner 탈퇴 정책을 함께 정한다. workspace에 프로젝트가 남아 있으면 직접 삭제를 막는 방향을 권장한다.
- 생성 시 workspace와 최초 owner membership을 한 트랜잭션으로 만든다. 마지막 owner 제거·역할 변경은 workspace 행 잠금 아래 검증하여 동시 요청으로 owner가 0명이 되는 것을 막는다.

## 진행 순서

1. ERD에서 멤버 복합 PK·role·시각 기본값·projects.workspace_id를 확정한다.
2. 실제 DB 마이그레이션으로 두 테이블과 nullable workspace_id를 추가한다. 기본 workspace와 명시적으로 지정한 owner를 만든 뒤 기존 프로젝트를 이관한다. 소유자를 기존 데이터에서 임의로 추정하지 않는다.
3. 이관 검증 후 FK·NOT NULL·인덱스를 적용한다. 현재 접근 가능한 사용자의 기존 프로젝트 접근을 어떻게 보존할지 함께 결정한다.
4. 중앙 권한 검사(owner 관리/editor 수정/viewer 읽기)를 HTTP·MCP·리뷰·개인 상태·동기화·WebSocket 구독/재연결/브로드캐스트·내보내기에 일관되게 적용한다. 클라이언트 필터만으로 접근 제어하지 않는다.
5. UI에 workspace 선택, 멤버 관리, workspace별 프로젝트 목록을 붙인다. v1에서는 프로젝트의 workspace 간 이동을 보류하여 기존 개인 메모·리뷰·동기화 이력의 이관 정책을 단순화한다.
6. 멤버 중복 방지, 외부 사용자 접근 거부, 역할별 쓰기 제한, 탈퇴 후 세션/소켓 접근 차단, 마지막 owner 동시 제거 방지, 기존 데이터 이관을 검증한다.
