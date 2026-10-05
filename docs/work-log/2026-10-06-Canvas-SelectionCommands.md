# Native에 기존 캔버스 선택과 명령 연결

- 계획: [CompleteParityRestoration](../planning/2026-10-06-Canvas-CompleteParityRestoration.md).
- 기존 selectionRect/intersectingObjects와 ContextMenu/ConfirmProvider를 사용한다. 다중 선택, marquee, 그룹 이동·경계 clamp, Shift/Control 선택, Ctrl+A, Delete와 우클릭 키보드 메뉴를 연결했다.
- 그룹 배치는 하나의 durable 입력과 shared 명령 묶음으로 저장한다. 개인 배치는 모든 명령을 같은 후보에 적용하고 한 번의 개인 CAS 저장으로 처리해 shared 원문을 보호한다. 오래된 다중 입력은 각 객체를 다시 확인한 뒤 재검토한다.
- Native 테이블 복사/붙여넣기·cut, 삭제 cascade preview, 원본 자동 배치, 빈 화면 생성, 도메인/FK 연결 preview 및 native 명령을 연결했다. 미지원 clipboard/DB 정책을 느슨하게 만들지 않는다.
- 도메인/메모 본문은 원본 DomainDescription을 사용하며 편집 권한과 busy에 따라 활성화한다. 입력을 durable 초안으로 먼저 보관하고 실패 시 복구 편집 화면으로 연결한다.
- 확대 버튼의 중심 좌표를 유지한다. 기존 v1 모델로의 투영은 없다.
- 검증: 선택/배치·개인 후보·삭제 범위·경계·숨겨진 노드·카메라 중심 회귀 추가. NativeERDCanvas/selection/draft-recovery/private-busy 4개 파일 89개 통과, 별도 서버 후보까지 포함한 앞선 집중 검사 46개 통과, 웹 타입 검사 통과.
- 도구별 연결 및 전체 source parity audit에서 확인한 더 세부적인 입력/관계/필터/목록/shell은 다음 통합 단위에서 이어간다. 실제 HTTP/DB 검증은 최종 통합 뒤 실행한다.
- 사용자가 코드·서버 검증만 선택했다. 브라우저·시각 모션 실측은 실행하지 않으며 단위 테스트를 화면 검증으로 간주하지 않는다.
