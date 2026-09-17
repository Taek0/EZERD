# 컬럼 기본값 선택 구현

- 기존 컬럼 상세 편집과 새 컬럼 생성에 타입별 기본값 선택을 추가했다. 현재 날짜·시각, 숫자 0/1, boolean, 빈 문자열, UUID, JSON, ENUM 선택값을 지원한다.
- 정수의 `자동 증가 (1부터)` 선택은 SERIAL/BIGSERIAL/SMALLSERIAL로 변경하고 기본값 SQL은 비운다. 상수 `1`과 구분하며 자동 증가 해제는 대응 정수 타입으로 돌아간다.
- 배열에는 스칼라 기본값을 제공하지 않으며, 타입·매개변수 변경은 기존 기본값을 초기화한다. NULL 불허 및 PK 전환은 NULL 기본값을 제거한다. 기존 외부 기본값은 선택 UI에 표시하여 보존한다.
- PostgreSQL exporter에 scalar TIME/TIMETZ의 CURRENT_TIME 허용을 추가하고 임의 SQL 및 배열 기본값 차단을 검증했다.
- 검증: 기본값/테이블 편집/PK/PostgreSQL 4개 파일 45개 테스트 통과, 웹 및 model TypeScript 검사 통과, `pnpm format` 및 `pnpm format:check` 통과.
- 환경의 `pnpm exec` 명령은 실행 파일 PATH를 찾지 못하여 테스트와 추가 타입 검사는 Node로 해당 설치된 CLI를 직접 실행했다.
