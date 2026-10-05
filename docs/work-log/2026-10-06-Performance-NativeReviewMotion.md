# Native 편집기에 원본 핀/댓글과 전환 연결

- 공통 리뷰 문서 타입을 domains/views/layout으로 좁혀 v1 변환 없이 Native에서도 원본 CommentsPanel, CommentPins, PinPanelResizer를 사용한다.
- 캔버스 좌표에 핀 추가, 핀 위치로 이동, 읽기 전용/개인 편집 권한, 댓글 패널 열기/닫기 모션을 연결했다.
- 리뷰 문맥은 scene/선택/화면이 바뀔 때만 전달한다. 카메라 이동마다 상위 편집기를 갱신하지 않는다.
- 화면 전환에 원본 domain-enter 240ms 효과를 적용하고 reduced motion을 존중한다.
- 도메인 경로와 도구를 한 toolbar에 배치하고 PNG 버튼을 직접 연결했다. 저장된 화면 내보내기의 기존 가드는 유지한다.
- 검증: web typecheck, comments 및 Native 입력 복구/권한 35개 테스트 통과. 브라우저 검증과 최종 통합 검사는 별도 진행한다.
