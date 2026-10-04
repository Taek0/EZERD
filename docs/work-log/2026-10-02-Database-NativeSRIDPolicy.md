# Native 공간 SRID 정책 결과

- [계획](../planning/2026-10-02-Database-NativeSRIDPolicy.md). 명시 MySQL SRID는 공통 `srid` feature 판정을 소비하고 검증한 0/4326 preset으로 제한한다. 미등록 SRID는 저장·DDL 환경 진단을 반환하며 변경하지 않은 기존 값은 trusted previous/cause 정책으로 보존한다.
- 기존 unsupported 값을 다른 unsupported 값으로 바꾸는 경로를 허용하지 않는다. DB별 타입 입력은 숫자의 구조 범위를 유지하고 유효 환경은 별도 검사한다. 웹은 원문을 포함하지 않는 한국어/영어 복구 안내를 표시한다.
- validator/진단 30개 통과, 관련 파일 Prettier 적용. advanced feature-path의 실제 4326 DDL/API 검증은 다음 활성화 단위에서 기록한다. 본 단위가 SRID 기능 전체 활성화 완료를 뜻하지 않는다.
