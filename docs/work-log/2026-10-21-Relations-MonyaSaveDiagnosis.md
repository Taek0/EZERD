# Monya 자동 관계선 저장 거부 원인

- MCP monya 프로젝트 bbae7fcb-72ba-4395-add3-a9e4ff13a546 version 10을 조회했다. 테이블·관계 각각 6개.
- sourceDocument에는 도메인별 테이블 배치 6개와 전체 테이블 화면(__tables__) 노드 1개만 존재한다. native.document의 표시용 보정본에는 전체 테이블 노드 6개가 있다.
- 표시용 문서로 nativeCanvasScene → arrangeRelationRoutes → nativeRelationArrangeLayouts → nativeRelationArrangeBatch를 재현하면 관계 6개 계산 및 명령 스키마 검증이 성공한다. 보정본 기준 후보 문서 검증도 오류가 없다.
- 같은 명령을 저장 원본 sourceDocument에 nativeEditorCandidate로 적용하면 upsertRelationLayouts에서 `화면에서 관계의 양쪽 테이블을 찾을 수 없습니다.` 예외가 재현된다.
- 서버 명령 처리 경로는 baseline.document로 후보를 만들고 해당 예외를 HTTP 400으로 변환한다. 정상 sync 결과 저장 이전이므로 최근 sync_operations에 해당 거부 기록이 없었던 것과 부합한다. 실제 사용자 요청 응답을 직접 캡처한 것은 아니다.
- 클라이언트는 400/409/422를 일반 저장 거부 문구로 표시하므로 실제 원인이 가려진다.
- 개선 방향: 자동 관계선 저장 시 화면 보정과 동일한 전체 테이블 배치를 서버에서 검증·구체화한 뒤 경로를 원자적으로 저장한다. 관계선만 저장하며 원본 배치가 존재한다고 가정하는 경로를 보완해야 한다.
- 진단은 읽기 전용 DB 조회 및 로컬 임시 테스트로 수행했다. 임시 테스트 파일 제거, 프로젝트 배치와 제품 코드 변경 없음.
