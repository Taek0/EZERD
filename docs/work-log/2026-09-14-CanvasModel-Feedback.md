# 캔버스 공유 모델 피드백 구현 기록

작성일: 2026-09-14

- `createForeignKeyFromPrimaryKey`가 PK 전체를 순서대로 복제하여 수신 테이블에 FK 컬럼과 관계를 한 번에 추가한다. 입력을 모두 검증한 뒤 새 문서를 반환한다. ID 충돌, 빈 PK, 키/테이블/컬럼 범위 오류를 거부한다.
- 컬럼 타입 파라미터와 ENUM ID를 보존하고 SERIAL 계열은 대응 정수 타입으로 바꾼다. 생성 기본값은 복제하지 않으며 새 이름의 충돌에는 숫자 접미사를 붙인다. SQL 관계의 source는 FK, target은 PK 테이블이다.
- 선택 도메인의 소유 테이블만 포함하는 영속 `views`와 `upsertCombinedView`를 추가했다. 원본 테이블 ID와 소유권, 기존 뷰 배치는 유지하고 도메인별 배치를 분리한다. 테이블 추가/소유권 이동, 도메인 삭제에 뷰가 동기화된다.
- 뷰별 `layout.relations` 경로 offset과 `upsertRelationLayout`를 추가했다. 관계/테이블/뷰 삭제 시 해당 경로를 정리한다. 함께 보기에서 노트, 뷰포트, 자동 배치와 문서 진단을 지원한다.
- 저장 계약 필드는 선택적이므로 기존 schemaVersion 1 문서와 호환된다. 뷰 ID의 전역 중복과 뷰별 관계 경로 중복을 검증한다.

검증: 신규 테스트 최초 실행에서 API 미구현으로 3건 실패(RED). 구현 후 복합 PK, ENUM, 이름 충돌, 입력 원자성, 도메인 삭제 및 뷰 동기화, 저장 round trip 테스트 통과(GREEN). `pnpm build:shared` 성공, `pnpm exec vitest run packages/model packages/contracts` 12개 파일 64개 테스트 통과.

추가 통합 검토: 자동 FK 컬럼은 기존 신규 컬럼 기본값인 NOT NULL을 유지하도록 보정했다. 같은 테이블 쌍을 여러 번 연결할 때 생성되는 제약 이름도 충돌하지 않도록 했다. 회귀 테스트 RED→GREEN과 공유 패키지 빌드를 확인했다.
