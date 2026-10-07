# MCP Native v2 전환

## 도구 변경

- `get_project`는 `get_project_document_state`와 같은 버전별 공유 문서 응답을 반환한다. 이전 `document/syncSequence` 대신 `sourceDocument/native/sequence`를 사용한다.
- `get_project_summary`, `list_tables`, `get_project_view`, `list_view_relations`, `get_table_details`는 native v2 원본 타입·표현식·제약을 유지한다. 응답에는 DB 컨텍스트·databaseRevision과 동시성 기준이 포함된다.
- `__tables__`, 도메인 필터, overview와 인증 사용자 개인 결합 화면을 지원한다. 다른 사용자의 개인 배치는 합치지 않는다.
- `diagnose_project`는 native DB 진단을 반환한다. `diagnose_layout`은 웹과 공유하는 native 카드 치수로 겹침·간격을 계산한다.
- `export_project`는 formatVersion 2 원본/preview 전송 파일을 반환한다. `import_project` 응답은 `{project, sequence, migrationIssues, issues}`다. 이전 파일은 기존 검증된 호환 가져오기 서비스에서만 처리한다.
- `update_project`는 이름·보관 상태 변경만 제공한다. DB 종류를 메타데이터만 바꾸는 입력은 제거했다. DB 변환은 별도의 검증된 변환 경로를 사용해야 한다.

## 제거한 도구와 대체 경로

| 제거한 도구 | 현재 도구 |
| --- | --- |
| apply_project_changes | apply_native_project_changes |
| get_project_history | get_native_project_history |
| undo_project_operation | get_native_project_baseline + undo_native_project_operation |
| restore_project_deletion | get_native_project_baseline + restore_native_project_deletion |

- 위 도구에만 쓰이던 MCP document/patch/read/response 모듈과 전용 테스트를 제거했다.
- 기존 REST 동기화·문서 업그레이드·전송 파일 검증에서 사용하는 v1 코드는 보존했다. 코드베이스 전체의 v1 삭제 작업 완료를 의미하지 않는다.
- schemaVersion 1 문서를 native 전용 조회에 넣으면 명시적인 업그레이드 안내를 반환한다. `get_project_document_state`로 원본을 확인하고 필요 시 `upgrade_project_document`를 사용한다.
- btrim 및 ENUM 표현식 비교 지원은 이번 MCP 경로 전환의 범위가 아니며 검증 정책을 완화하지 않았다.

## 검증

- 전체 `pnpm check` 통과: 테스트 2,819개 통과, 506개 조건부 건너뜀. 포맷·타입·빌드 통과. 기존 번들 크기 경고는 남아 있다.
- 임시 격리 PostgreSQL DB에서 마이그레이션과 실제 MCP 통합 시나리오 5개 통과. 삭제 도구 비노출, native 편집 재시도·actor 권한, undo/restore, 가져오기·내보내기, 개인 화면 격리를 포함한다.
- Native 조회 단위 테스트 9개와 MCP 등록·타입 경계 테스트 16개, 카드 치수 공유 관련 테스트 43개도 통과했다.
- 운영 프로젝트 데이터나 운영 DB 스키마는 변경하지 않았다. MCP 외 REST·기존 저장 문서 호환 코드는 후속 정리 범위다.
