# MCP 편집 기능 보강 기록

## 결합 화면과 ENUM 명령

- `apply_project_changes`에 `upsert_combined_view`, `delete_combined_view`, `upsert_enum`, `delete_enum`을 추가했다.
- 기존 모델 함수를 재사용해 결합 화면의 배치 연동과 ENUM 참조 제한을 유지했다.
- 검증: MCP 문서 변경 테스트 4개 통과, 서버 타입 검사 통과.
