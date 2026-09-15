# 도메인 뷰 관계선 편집 결과

- 도메인 뷰 관계선의 끝점·구간 이동과 자동 정리 기능을 활성화했다. 노드 이동·크기 변경·자동 배치 제한은 유지한다.
- Canvas의 두 관계 렌더링 레이어가 syncLayoutPolicy.editRoutes를 따른다. 읽기 전용에서는 모든 조작이 차단된다.
- applyRoutePatch는 viewId별로 경로를 갱신하여 원본 도메인의 노드·경로를 변경하지 않는다.
- diffSharedDocument가 개인 도메인 뷰 경로를 전송에서 제외하며 mergePersonalState가 원격 변경 후 해당 경로를 다시 부착함을 테스트했다.
- 저장 수명은 기존 개인 도메인 뷰 정책 그대로 현재 프로젝트 세션이다. 재접속 문서 동기화에서는 유지하지만 프로젝트를 닫거나 새로고침한 후의 영속 저장은 기존에 없고 이번에도 추가하지 않았다.
- 검증: 관계 편집 관련 4개 파일 21개 테스트 통과, web typecheck 통과. pnpm format 적용, pnpm format:check 통과.
