# C4 native 생성·갱신 및 FK 파생 편집 모델

- 시작 `9ae996b`, 작업 트리 깨끗함. DB별 factory와 immutable 편집 후보 함수를 model에 추가한다. 웹/MCP 소비는 후속 단위이며 coverage gate와 shared v2 저장은 활성화하지 않는다.
- 테이블 factory는 namespace/table options, 컬럼 factory는 profile의 기본 타입·기본 파라미터와 소유 테이블 scope를 적용한다. legacy 입력을 신규 타입 후보로 생성하지 않는다.
- 컬럼 추가/부분 갱신 및 테이블의 표시·physical 속성 부분 갱신에서 DB 문맥·소유자·전역 ID·legacy provenance를 보존한다. 갱신은 type/default/generation/options 등 입력된 필드만 변경하며 타입 변경을 이유로 나머지 정보를 자동 삭제하지 않는다. 테이블 도메인 이동과 배치는 별도 공통 canvas 단위로 남긴다.
- 부분 patch의 strict runtime 계약을 기존 native 필드 계약으로 구성해 id/tableId/domainId/DB 문맥 주입과 unknown 필드 무시를 차단한다. 전체 후보의 저장 스키마·예산 검사는 여전히 별도 필수 경계다.
- FK 생성은 순서 있는 전체 PK를 child→parent 방향으로 복사한다. 새 컬럼 ID/관계 ID를 사전 검사하고 DB별 타입·배열/ENUM·부호·collation/charset을 보존한다. 부모 identity/serial/autoIncrement/computed/default 및 MySQL onUpdate를 child에 복사하지 않는다. MySQL 문자열의 상속 table charset/collation은 child 컬럼에 명시해 의미를 보존한다. legacy 타입·미해결 ENUM·deferrable PK·virtual generated target 등은 차단하며 부모/기존 컬럼은 변경하지 않는다.
- factory/편집 후보는 저장 승인 함수가 아니다. 서버 lock 아래 구조/예산/참조·DB write policy 및 retired ID 검사가 여전히 필수다. unverified native 기능을 helper 추가만으로 usable로 표시하지 않는다.
- 세 DB 기본값/긴 수치/복합 FK/생성 규칙 제거/문자집합/immutable patch/원문 유지 및 신규 legacy 차단을 테스트한다. 전체 format/type/test/build와 결과 기록·독립 커밋을 마친다.
