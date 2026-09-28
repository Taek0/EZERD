# MCP 편집 기능 보강 기록

## ENUM 명령

- `apply_project_changes`에 `upsert_enum`, `delete_enum`을 추가했다.
- 기존 모델 함수를 재사용해 ENUM 참조 제한을 유지했다.
- 검증: MCP 문서 변경 테스트 4개 통과, 서버 타입 검사 통과.

## 개인 화면 경계 수정

결합 화면과 뷰포트는 `sharedDocument`에서 제외된다. 첫 명령 시도에서 다른 공유 변경과 함께 요청하면 개인 화면 명령이 성공처럼 보이지만 저장되지 않는 문제를 발견했다. 공유 문서 명령에서 해당 개인 상태 명령을 제거하고, 사용자별 서버 저장과 웹 연동을 별도 구현하도록 계획을 수정했다.

## 공유 배치와 개인 화면 저장

- 공유 문서의 `update_node_layout`, `upsert_relation_layout`, `delete_relation_layout` 명령을 추가했다. 결합 화면 배치는 공유 명령에서 거부한다.
- 사용자·프로젝트별 개인 상태와 작업 재시도 기록을 위한 DB 테이블 및 마이그레이션 0009·0010을 추가했다. 앱 준비 검사도 새 테이블을 확인한다.
- 개인 상태는 결합 화면·메모·참조 노드·뷰포트·관계 경로로 분리했다. 삭제된 공유 도메인·테이블의 참조는 조회 시 정리한다.
- REST 개인 상태 조회·저장과 MCP `get_personal_state`·`apply_personal_changes`를 연결했다. MCP 개인 명령은 사용자별 버전과 작업 ID로 충돌·재시도를 검사한다.
- 웹 동기화 런타임이 개인 상태를 불러오고 개인 변경을 별도 API에 저장하며, 주기적으로 다른 MCP/웹 변경을 다시 읽는다.
- MCP 범위별 프로젝트 조회는 인증 사용자 자신의 개인 화면을 병합해 반환한다.

검증: 단위 테스트 68개 파일 353개, 격리 PostgreSQL·API·WebSocket·MCP 통합 테스트 3개 파일 24개, 전체 타입 검사와 Prettier 검사를 통과했다. 실제 MCP·REST 호출에서 사용자 격리와 재시도를 확인했다. 기존 개발 DB에는 새 마이그레이션을 적용하지 않았다.

## 부분 수정 명령

- 공유 문서에 `patch_domain`, `patch_table`, `patch_column`, `patch_note`, `patch_domain_relation`, `patch_key`, `patch_table_relation`, `patch_enum`을 추가했다.
- 개인 화면에 `patch_combined_view`, `patch_note`를 추가했다.
- 중첩 필드는 기존 값과 병합하고, 객체 ID·컬럼 소유 테이블·키 소유 테이블은 변경하지 않는다. 대상이 없거나 패치가 비어 있으면 거부한다. 색상은 `null`로 제거할 수 있다.
- 검증: 부분 수정 단위 테스트와 서버 타입 검사 통과. 격리 PostgreSQL·MCP 통합 테스트에서 테이블의 논리 이름만 수정하고 다른 필드는 유지되는지 확인했다.
