# MCP 재시작 후 실제 연결 검증

## 대상과 결과

- 재시작된 EZERD MCP 서버에 연결해 등록된 도구 28개와 `list_projects` 응답을 확인했다. 인증 오류나 서버 연결 오류는 없었다.
- 새 프로젝트 `MCP-Live-QA-2026-09-28-7ad91aac` (`707a7ff4-0b77-4a55-a9e1-ac41fca6a774`)에서만 검증 데이터를 변경했다. 이 프로젝트는 결과 확인용으로 유지한다.
- 마지막 공유 문서 버전·동기화 순서는 각각 7, 개인 상태 버전은 6이다. 도메인 2개, 테이블 2개, 컬럼 4개, 키 2개, 도메인 관계 1개, 테이블 관계 1개, 공유 메모 1개가 남았다.
- `diagnose_project`, `diagnose_layout`의 최종 진단은 모두 빈 배열이었다.

## 라이브 도구 검증

| 범위 | 도구와 확인 내용 | 결과 |
| --- | --- | --- |
| 탐색 | `list_projects` 검색·상태·커서, `get_project_summary`, `get_project`, `get_project_view` 커서, `list_tables` 커서, `get_table_details`, `list_view_relations`, `get_personal_state` | 성공. 요약·상세·화면·전체 문서 응답을 대조했다. |
| 공유 설계 | `apply_project_changes`로 도메인·ENUM·테이블·컬럼·키·관계·메모 생성, 8종 부분 수정, 배치·관계 경로 변경·삭제 | 성공. 각 단계에서 재조회했다. |
| 개인 화면 | `apply_personal_changes`로 결합 화면 생성·수정·삭제, 뷰포트, 테이블 참조 제거·재추가, 노드 배치, 관계 경로·개인 메모 생성·수정·삭제 | 성공. `get_personal_state`와 화면·관계 조회에 반영됐다. |
| 이력·진단 | `get_project_history` 변경값·삭제 스냅샷·커서, `diagnose_project`, `diagnose_layout`, `undo_project_operation`, `restore_project_deletion` | 성공. 삭제 메모는 새 ID로 복원됐고, 임시 메모의 생성 작업은 취소됐다. |
| 리뷰 | `create_review_thread`, `list_review_threads`, `get_review_thread`, `reply_review_thread`, `update_review_thread`, `delete_review_thread` | 성공. 생성·답글·해결 후 삭제했고 최종 목록은 비었다. |
| 프로젝트 관리 | `create_project`, `export_project`, `import_project`, `update_project`, `delete_project` | 성공. 내보내기 문서에는 개인 결합 화면이 포함되지 않았다. 가져온 임시 프로젝트 `b947ce9c-809b-4c34-ad47-a452cd0f4c04`는 이름 변경·보관을 확인한 뒤 삭제했다. |
| 알림 | `list_notifications`, `update_notification` | 목록 조회와 존재하지 않는 ID에 대한 거부 응답을 확인했다. 기존 프로젝트에 속한 유일한 본인 알림은 변경하지 않았다. 새 프로젝트를 통한 성공 경로는 라이브에서 미검증이다. |

첫 개인 화면 변경은 조회 이후 개인 버전이 0에서 1로 바뀌어 동시성 충돌로 거부됐다. 최신 개인 상태를 다시 읽고 버전 1로 재시도하자 성공했다. 공유 배치 변경의 첫 요청은 잘못 추측한 노드 ID가 거부됐고, 화면 조회에서 실제 ID를 확인해 다시 요청하자 성공했다. 두 경우 모두 거부된 요청이 문서를 변경하지 않았다.

## 자동 검증과 정리

`pnpm test:integration` 통과: 테스트 파일 3개, 테스트 25개. 격리 통합 테스트는 두 사용자 계정으로 알림 생성·읽음 변경의 성공 경로도 확인한다. 빌드 중 번들 크기와 일부 소스맵 경고는 있었으나 빌드·테스트 실패는 없었다.

검증용 가져오기 프로젝트와 리뷰 핀은 삭제했다. 메인 검증 프로젝트와 그 안의 샘플 ERD 및 개인 결합 화면은 사용자가 확인할 수 있도록 남겼다. 기존 프로젝트와 `docs/EZERD.txt`는 변경하지 않았다.
