# C2d/C3 native 동기화 모델 준비

- 시작 HEAD `06490b2`. [전체 명세](2026-10-01-Database-CapabilitySpecification.md)의 v2 sync/이력 소비를 위한 순수 모델 단위다.
- 기존 ID 기반 diff/apply/overlay 코어를 v1/v2 문서에 공통으로 적용한다. v1 결과와 fingerprint 의미를 보존하고 native indexes/checks를 엔티티 단위로 추가·삭제·이동·snapshot에 포함한다.
- native generation/default/options/namespace와 index/check AST를 원자 필드로 다룬다. discriminant만 섞이거나 AST 한 부분이 다른 참조로 병합되지 않도록 한다.
- key/FK 외에도 생성식·기본값·index/check의 컬럼 참조 및 include/predicate/타입·테이블 옵션 의존 경로를 서버가 파생할 수 있게 준비한다. 온라인 구조 참조/오프라인 충돌/undo 검사에 같은 read-set을 사용한다.
- 일반 sync로 schemaVersion 또는 DB 문맥을 바꾸지 못하게 한다. 업그레이드/DB 변환은 별도 원자 API로 남긴다.
- 최종 구조/native 정책 검증은 별도 소비 경로에서 수행한다. 이 단위는 API 저장이나 UI의 v2 활성화를 하지 않는다. 순수 모델 경계/기존 회귀 테스트와 전체 필수 검증 후 독립 커밋한다.
