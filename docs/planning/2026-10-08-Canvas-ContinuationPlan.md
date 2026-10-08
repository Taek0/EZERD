# 카드 및 참조 후속 자동저장 보완 계획

- 참조 복구폼: 최초 add_table_reference 이후 좌표 입력은 실제 배치 노드의 update_node_layout으로 전환한다. ACK 이후 문서 반영 지연과 개인 화면의 서버 생성 노드 ID도 검증한다.
- 카드 인라인: blur 없는 unmount, debounce 중 선택 전환, 저장 중 후속 타이핑, IME·타입 검색·권한/DB 기준 변경을 회귀 검증한다. cleanup 후에도 유효한 텍스트 입력을 배출하되 새 세션 UI나 다른 revision을 변경하지 않는다.
- NativeERDCanvas 및 NativeCanvasInlineCell과 관련 테스트만 수정한다. CanvasInputForm와 공용 autosave hook은 다른 워커 소유다.
- 각 수정 단위별 테스트·변경 파일 포맷을 확인한다. 후속 사용자 지시에 따라 git add/commit은 중지하며, 오너가 변경 파일별 커밋을 순차 수행한다.
