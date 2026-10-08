# Native 전용 프로젝트 진입

- [계획](../planning/2026-10-07-Legacy-NativeOnlyEditorPlan.md)의 첫 단위 완료.
- projectEntry가 원본 schemaVersion 1을 사용자 안내와 함께 거부한다. Native 미리보기 유무와 active/archived 상태에 관계없이 적용한다.
- ProjectEntry 타입에서 legacy 분기를 제거하고 App·갤러리 로더 소비자를 갱신했다. 공통 loadProjectEntry를 쓰는 갤러리와 알림 진입에 적용된다.
- 원본 데이터 변형이나 쓰기·동기화 전송 없이 v1을 거부하는 테스트를 추가했다. Native 문서의 개인 상태 병합과 미리보기 불가 동작은 유지한다.
- pnpm typecheck와 관련 5개 테스트 파일의 67개 테스트 통과. 제품 서버 API/MCP 자체의 v1 지원은 이번 웹 경계 변경의 대상이 아니다.
