# 기존 캔버스 UI·세부 조작·모션 복구 결과

## 기준과 범위

- 요청: 기존 코드 전체를 확인하고 현재 Native 버전에서도 시각적 효과·세부 요소·컴포넌트를 복구한다.
- [전체 계획](../planning/2026-10-06-Canvas-CompleteParityRestoration.md), [원본 대조 감사](2026-10-06-Canvas-ParityAudit.md)의 41개 차이를 소비 경로까지 확인했다.
- 원본 Canvas/TableEditor/domain/relations/common UI/shared editor/styles/App shell을 기준으로 컴포넌트와 스타일을 재사용하고 Native 데이터/명령에 연결했다. 원본 legacy 캔버스는 보존하며 Native 모델·DB 정책·서버 검증·durable ACK·private 격리는 유지한다.

## 감사 항목 최종 연결

| 항목 | 복구 및 실제 연결 |
| --- | --- |
| E01 | NULL/required 공통 Checkbox를 native partial patch에 연결. PK NULL과 읽기 전용·busy 변경을 차단한다. |
| E02 | 원본 DomainDescription의 도메인/메모 편집. 권한이 있을 때만 callback을 제공하고 durable 본문 초안·실패 복구를 연결한다. |
| E03–E05 | NativeCanvasInlineCell과 공통 Input/SearchType/Tooltip: 포커스/더블클릭/F2, Enter/blur/Tab, Escape, IME/229, 초기·복귀 포커스, 실패/늦은 ACK·고급 타입 입력 보존. |
| E06 | toolbar/빈 화면/context 생성은 현재 화면 좌표와 native ID를 사용하고 수락된 객체를 선택한다. 컬럼/ENUM/검토형 작업은 원본 panel/modal로 연결한다. |
| E07 | 설명 autosize와 너비 변경 재측정·observer 해제. |
| E08 | selectedColumnId를 실제 Scene/Rows에 전달하여 카드와 패널 선택을 맞춘다. |
| V01–V02 | Canvas scope/filter를 outline·counts·검색·현재 경로/선택 context에 전달한다. |
| V03–V05 | 원본 endpoint 이름 검색·trim, 도메인 Open/소유·참조 배지/컬럼 count, 필터 popup 위치·Apply/Close·동적 all/명시 finite 구분. |
| V06 | 도메인 Open은 전체 테이블 보기의 로컬 필터로 이동하며 공유 배치 identity는 유지한다. Native의 저장된 개인 보기는 private 상태/권한으로 보존한다. |
| R01–R02 | 도메인/테이블 관계 선택·목록·context 메뉴를 해당 속성 inspector와 실제 경로 편집에 연결한다. |
| R03 | 관계 이름·설명·cardinality·required·양쪽 min/max와 fallback, 미편집 explicit 의미 보존. |
| R04 | 기존 관계 ID를 유지한 source/target 변경·paired column 검토·physical:null 제거·full physical 추가/복원. strict 계약과 locked 서버 검증 및 actual HTTP를 연결한다. |
| R05–R06 | 선택 테이블/도메인의 연결된 관계 목록, 속성 편집·Open·생성·삭제 quick action. |
| R07–R08 | route pointer-up/방향키 guarded submit·선택 유지, 자동 경로/삭제 context, 명시적 endpoint/label/cardinality/leader/tooltip. |
| N01–N02 | note 선택이 이전 table/domain property를 제거하고 본문/색상/위치/크기 inspector를 연다. private note와 shared 원문을 분리한다. |
| N03–N04 | comment 기본 true를 DOM/metrics/inspector에서 일치시킨다. 원본 색상 picker·inherit/reset/HEX·미완성 원문 유지. |
| N05–N07 | PK/FK/UQ 복합 배지, reorder drag/drop feedback와 검증 명령, PK/NULL/배열 등 native 정책/부분 patch. |
| N08 | 원본 ENUM modal/backdrop/검색·목록·폼·Escape/close/focus·모션을 native 값에 연결한다. |
| S01–S03 | 원본 inspector 선호값 저장, measured workspace 폭에 따른 bounds/stacking·키보드 resize·drag 중 transition 중지·comments/좁은 레이아웃·스크롤. |
| S04–S05 | App heading/path/toolbar host, save/history/panel toggles와 실제 workspace 역할·status. JSON/DDL/필터 PNG를 공유 dropdown 한곳에 연결한다. |
| S06–S07 | PNG에 현재 필터와 source/personal export fence 적용. 원본 카드 치수·font token·clip·palette와 경로 표현을 사용하고 버튼/편집 controls는 제외한다. |
| S08–S09 | scene 240ms 진입, 공통 PanelListDetail·Accordion/AnimatedDetails·Popover/Tooltip 및 reduced-motion·interruption 경로를 재사용한다. |
| S10–S11 | Native의 실제 queue/dirty/busy/rejected/offline/확인 상태를 원본 shell에 표시한다. note/relation selection과 review context를 전달하고 핀 focus를 실제 캔버스 중앙으로 맞춘다. |

기존 marquee/다중 선택·Shift/Control·그룹 이동·경계 clamp·copy/cut/paste·Delete/확인·자동 배치·손/커서·공간 이동·확대 중심·카드 크기·context/컬럼 Shift+F10·FK/도메인 연결 preview도 native 명령/개인 CAS 경로에 연결했다. 미편집 카드 size/color는 변경 요청에 섞지 않는다.

## 검증

- `pnpm format` 적용 후 최종 코드 HEAD `be11a4a`의 `pnpm check`: 포맷·전체 타입·서버/웹 빌드 통과. **215개 파일 / 2,742개 테스트 통과**, 27개 파일 / 500개 환경 조건부 테스트 skip.
- 전체 빌드 후 독립 PostgreSQL QA DB에서 6개 integration 파일 / **99개 테스트 통과**: native canvas parity/decoration/deferrable/history/versioned document/autosync. migration·cleanup 통과. 이후 서버/계약은 변경하지 않았으며 마지막 Root column capture와 tooltip UI도 최종 전체 check/build로 확인했다.
- 세 DB 프로젝트의 실제 HTTP로 그룹/필터 배치, ACK replay, 잘못된 묶음/끝점 취소, 개인 상태 격리, FK endpoint/physical 제거·재추가, 원문/id/논리 내용 보존을 확인했다. SQL 엔진에서 DDL을 새로 실행한 검사로 계산하지 않는다.
- 첫 전체 검사의 recovery 시험 mock·오래된 component lookup 가정을 [회귀 환경 결과](2026-10-06-Canvas-RecoveryHarnessResult.md)에 기록하고 수정했다. 마지막 컬럼 keyboard capture 수정은 집중 43개와 typecheck, 관계의 사람이 읽을 수 있는 endpoint/컬럼/설명 tooltip은 집중 22개와 typecheck를 통과했고 최종 전체 check/build도 통과했다.

## 검증 한계와 보존

- Browser가 QA origin 접근을 자동 승인 검토에서 거절했고, 사용자가 **코드·서버 검증만 진행**을 선택했다. 다른 브라우저/우회 경로로 재시도하지 않았다. screenshot/pixel/실행 중 animation/FPS/실제 브라우저 레이아웃 동등성은 검증하지 않았다. 코드 연결 완료와 시각적으로 완전히 동일함의 실측 확인을 구분한다.
- 기존 대용량 bundle 경고는 남아 있다. 최종 웹 bundle은 1,956.91 kB(minified), gzip 548.31 kB다. 경고를 숨기거나 모션을 제거하지 않았다.
- Native queue의 깨끗한 표시는 저장 기준 확인 상태이며 신규 실시간 협업/웹소켓 처리 완료를 추가로 주장하지 않는다. DB별 정책에 따라 지원되지 않는 작업은 원문 조회/비활성 guard를 유지한다.
- 실제 사용자 데이터와 docs/EZERD.txt는 변경하지 않았다. 임시 QA 서비스/DB는 생성한 scope와 데이터 유입 guard를 확인해 정리했다. 변경은 작은 독립 커밋으로 기록했으며 원격 push/배포는 하지 않았다.

관련 결과: [카드·시각 표현](2026-10-06-Canvas-CardVisualParity.md), [인라인 편집](2026-10-06-Canvas-InlineEditingParity.md), [인스펙터 감사 후속](2026-10-06-Canvas-InspectorAuditCompletion.md), [선택/명령](2026-10-06-Canvas-SelectionCommands.md), [Root 통합](2026-10-06-Canvas-EditorIntegration.md), [FK 서버](2026-10-06-Canvas-ForeignKeyEndpointResult.md), [FK UI](2026-10-06-Canvas-ForeignKeyInspectorResult.md).
