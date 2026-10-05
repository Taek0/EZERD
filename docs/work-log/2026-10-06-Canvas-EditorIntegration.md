# 원본 편집기 UI의 Native 전체 소비 연결

- 계획: [CompleteParityRestoration](../planning/2026-10-06-Canvas-CompleteParityRestoration.md), 대조: [ParityAudit](2026-10-06-Canvas-ParityAudit.md).
- Root가 실제 editorContext를 Scene/Rows의 인라인 셀에 전달한다. 선택한 컬럼·관계·메모·도메인을 속성 패널과 연결하고, NULL/required 체크박스·컬럼 context menu·도메인/FK 연결·생성 후 선택을 Native 저장 경로에 연결한다. 읽기 전용 column 메뉴는 context가 없는 경우 쓰기를 활성화하지 않는다.
- scope callback으로 현재 필터의 객체/관계 목록·counts·경로를 동기화한다. 도메인 Open은 원본처럼 전체 테이블 보기의 로컬 필터를 선택한다. 같은 카메라 이동에서 Scene에 새로운 이벤트 callback/선택 배열을 전달하지 않도록 stable ref wrappers와 memo를 사용한다.
- 원본 App header의 toolbar/path host와 panel toggle을 연결한다. 공유 dropdown 한곳에서 JSON/DDL/현재 필터 PNG를 제공한다. PNG 문맥에는 필터도 포함해 비동기 생성 중 필터가 바뀌면 중단한다. App의 실제 workspace 상태/역할을 안내에 전달한다.
- Scene와 SVG/PNG의 card metrics, header 84px, 관계 caption 폭을 같은 helper로 계산한다. 원본 grid가 카메라 이동·확대와 함께 움직인다. source animation/reduced motion과 공통 tooltip/accordion/색상 picker는 원본 구현을 재사용한다.
- 메모와 도메인의 위치/크기·메모 본문/색상 inspector를 연결했다. 미편집 size/color를 저장 요청에 포함하지 않는다. private 입력은 private version을 확인하며 공유 원문을 바꾸지 않는다. 실패한 본문/inspector 입력은 해당 객체/보기의 durable 초안으로 복구한다.
- 경로 조작은 pointer-up/방향키에서 guarded submit으로 저장하고 선택을 유지한다. 속성/자동 경로/삭제의 context menu, 관계 선택과 review context를 연결한다. 핀 focus는 실제 캔버스 크기로 중앙에 배치한다.
- 집중 검증: Root/selected object/recovery/route/private PNG 107개와 Root/inspector/toolbar/recovery 105개 통과, 메모의 미편집 palette/배치 보존과 stale/잘못된 치수 4개 추가. 웹 타입 검사 통과. 서버 FK/동기화 회귀 및 실제 HTTP 검증은 관련 별도 결과를 참조한다.
- 사용자가 코드·서버 검증만 선택했다. Browser origin 접근을 재시도하지 않았으며 pixel/실행 중 animation 비교는 하지 않았다. 전체 pnpm check는 최종 통합 검증 기록에 남긴다.
