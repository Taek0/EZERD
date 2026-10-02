# C2a native 문서 모델·v1 어댑터 구현 결과

- 날짜: 2026-10-01
- 계획: [C2 native 문서](../planning/2026-10-01-Database-NativeDocumentImplementation.md)

## 변경

- 기존 v1 타입과 병존하는 NativeDesignDocument v2, DB별 typeId/파라미터 union, 생성/기본값/namespace/table 옵션, index/check 및 안정적 컬럼 ID를 사용하는 제한 식 모델을 추가했다.
- v1 PG 타입/별칭/serial/ENUM/배열은 원래 의미를 유지해 변환한다. 정수·소수 및 JSON 문자열은 JS number를 거치며 값을 바꾸지 않는다.
- v1 MySQL/SQLite 표시 데이터, unknown/잘못된 파라미터, 미등록 SQL 기본값은 원본을 보존한 legacy 분기와 진단을 반환한다. 원본을 변경하지 않으며 GET/DB에 자동 저장하지 않는다.
- 식 참조 remap/수집 함수에 깊이 32/노드 2048 한도를 적용했다. 진단 경로는 ID의 JSON pointer 특수 문자를 이스케이프한다.
- 기존 서버/편집기/JSON 전송은 아직 v1 API로 유지한다. 신규 모델을 제품 저장에 활성화하는 것은 C2b 계약과 C3 문맥 보호 연결 후 진행한다.

## 검증

- 모델 빌드 및 전체 `pnpm typecheck` 통과.
- 모델 회귀 테스트 17개 파일 154개 통과. 이후 버전 거부·진단 경로 회귀를 추가한 migration 테스트 10개 통과.
- 초기 식 remap 테스트는 배열의 부분 비교가 전체 배열 길이를 요구해 실패했고, 실제 값과 참조 두 원소를 함께 확인하도록 수정했다. 실제 remap 결과의 오류는 아니었다.
- `pnpm format:check`, diff 공백 검사 통과. 마지막 두 파일은 동일 설정의 Prettier로 적용했다.
- 실제 DB 실행은 아직 수행하지 않았으며 카탈로그 활성 상태를 올리지 않았다.

## 다음

C2b에서 native 문서/타입/기본값/식의 구조 계약과 v1/v2 전송 reader를 추가한다. 이후 프로젝트 profile/revision 마이그레이션과 서버 정책을 연결한다. 전체 구현은 진행 중이다.
