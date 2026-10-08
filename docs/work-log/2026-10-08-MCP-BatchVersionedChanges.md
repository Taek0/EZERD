# MCP 일괄·버전 확인·변경분 조회

- get_tables_details: 최대 20개 테이블 상세를 한 요청으로 조회한다. 중복 ID는 순서를 유지해 제거하고 없는 ID가 있으면 전체 요청을 거부한다.
- list_tables/get_project_view/list_view_relations와 일괄 상세에 expectedSequence 및 expectedDatabaseRevision을 함께 지정할 수 있다. 변경되면 409로 처음부터 재조회를 요구한다. 과거 snapshot을 서버에 고정하는 기능은 아니다.
- 동결된 공유 문서만 WeakMap 인덱스를 재사용하며 도메인별 집계·테이블별 컬럼/키/관계/제약 탐색을 줄였다. 사용자 개인 배치는 공용 캐시에 넣지 않는다.
- get_project_changes: since 이후의 작업 요약·변경 경로·객체/삭제 ID를 반환한다. 변경값·전체 문서·삭제 snapshot은 조회하지 않는다. 상세 값이 필요하면 해당 객체를 별도로 조회한다.
- 첫 페이지의 untilSequence를 후속 cursor에 고정한다. 이력 누락·DB/형식 경계·잘못된 이력 및 256 KiB 응답 한도 초과는 resyncRequired로 명시한다. 기본 25개, 최대 100개 작업이다.
- 도구 안내에 일괄 상세와 버전 확인 및 전체 재조회 기준을 추가했다. 현재 도구 수는 52개다.
- 관련 단위·격리 DB MCP 통합 8개 및 전체 pnpm check(2,856개 테스트, 타입·포맷·빌드)를 통과했다.
- 도메인 곡선의 정밀 충돌 검사는 이전 배치 진단과 같이 미검증 범위로 표시한다. 이번 변경으로 지원한다고 주장하지 않는다.
