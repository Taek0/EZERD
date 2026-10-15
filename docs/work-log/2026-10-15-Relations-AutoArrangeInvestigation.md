# 관계선 자동 정리 코드 조사 결과

## 범위와 결론

- 기준: codex/performance-lab, 조사 시작 HEAD d90b169, 원격 main 2efbbd5 반영 상태. 정적 코드 조사만 수행했으며 제품 구현·DB·서버·테스트는 변경/실행하지 않았다.
- 구현 가능성이 높은 구조다. 네 면 연결점과 경유점 저장, 직교 장애물 회피, 서버 저장·히스토리 기반은 이미 있다. 전역 선 배치와 비동기 작업 제어는 추가가 필요하다.
- 사용자 용어 출발=PK, 도착=FK와 달리 내부 sourceTableId/sourceAnchor는 FK, targetTableId/targetAnchor는 피참조 PK/UNIQUE 쪽이다. 내부 의미를 뒤집지 않고 UI 용어를 대응시킨다. NativeTableRelationInspector.tsx:55와 NativeTableLines.tsx의 설명 생성에서 확인했다.

## 1. 관계 모델 및 저장

- packages/model/src/document-base.ts: RelationAnchor는 side(left/right/top/bottom), ratio. RelationLayout은 relationId/viewId/offset/bend/sourceAnchor/targetAnchor/waypoints를 갖는다.
- packages/contracts/src/workspace.ts와 model/src/document.ts의 upsertRelationLayout은 비율·좌표·최대 128개 경유점 등을 검증한다.
- packages/contracts/src/native-editor-command.ts의 upsert_relation_layout과 apps/server/src/mcp/mcp-native-document.service.ts의 적용기를 재사용 가능하다.
- 자유 연결점/경유점 때문에 새 DB 저장 컬럼을 추가할 필요는 현재 발견하지 못했다. 대량 적용 명령을 신설하면 API 계약과 적용기는 변경해야 한다.
- NativeERDCanvas.tsx:nativeCanvasScene은 저장된 anchor를 물리 모드의 컬럼 행 기반 anchor보다 우선한다. 명시 anchor 저장으로 네 면 배치가 가능하다.

## 2. 현재 경로 계산

- 실제 웹 경로 계산은 features/relations/relation-routing.ts에서 @ezerd/model의 relationGeometry를 재노출한다. .reference.ts는 제품 실행 경로로 오인하지 않아야 한다.
- packages/model/src/relation-routing.ts는 직교 경로 후보, 장애물 확장(18), sparse visibility grid 탐색, 길이+꺾임 비용, 수동 경유점 처리, 라벨 위치 계산을 제공한다.
- score는 거리와 꺾임 수를 고려하지만 다른 선의 중첩·교차·간격을 입력받지 않는다. nativeCanvasScene은 관계별로 독립 호출한다.
- lane은 전역 관계 배열 인덱스다. 카드 면별 연결 수에 따른 균등 배치가 아니며 ports의 clamp로 여러 선이 같은 위치에 몰릴 수 있다.
- ports/anchorPort는 경계 바깥 tip 8, stub 44를 사용한다. 고정 출구 직선 길이를 강제하지 않으려면 자동 후보와 clearance 전제를 함께 검토해야 한다. 표시 기호 공간까지 무조건 제거하면 안 된다.
- 수동 waypoints가 부적합하면 자동 후보로 대체될 수 있다. 최종 fallback은 겹친 카드에서도 가시 경로를 반환하므로 결과가 엄격한 비침범 해답인지 별도 검증해야 한다.
- 재사용: 충돌 판정, 경로 단순화, 기존 경로 후보/탐색, anchor 변환. 추가: 면별 포트 배정, 상대 테이블 순서 기반 정렬, 혼잡 분산, 전역 통로 점유와 선 간격 비용, 반복 개선과 결과 검증.
- 라벨은 카드 회피를 하지만 선/라벨 상호 충돌의 전역 최적화는 별도다.

## 3. 수동 편집

- native-route-edit.ts의 nativeRouteCommand/nativeRouteDrag/nativeRouteGeometry는 anchor·waypoints를 기존 명령으로 변환·검증한다.
- 자동 정리는 기존 수동 anchor/bend/waypoints를 고정 제약으로 쓰지 않고 전체 대상 결과로 교체한다. 변경 없는 관계는 저장 명령에서 제외할 수 있다.
- NativeTableLines.tsx에는 선택·키보드 동작과 PK→FK/컬럼 정보 title이 있다. 선 hover/select에 따른 양쪽 컬럼 강조 상태 전달은 추가해야 한다.

## 4. 카드 크기와 좌표

- nativeCanvasScene은 저장 크기와 nativeTableCanvasMetrics를 합쳐 실제 카드 경계를 계산한다. model/src/native-table-canvas.ts의 metrics와 웹의 재노출 경로를 재사용한다.
- canvasPoint는 화면 좌표에서 카메라 이동·배율을 제거한다. 알고리즘은 화면 픽셀이 아닌 월드 좌표를 사용해야 한다.
- scene.nodes는 현재 뷰·도메인 필터·논리/물리 표시를 반영하며 화면 viewport 자체로 자르지는 않는다. 필터 때문에 빠진 테이블을 장애물에서 제외할지는 따로 결정해야 한다.
- viewFor는 overview 이외를 __tables__로 매핑한다. 도메인 화면에서 저장한 경로가 전체 테이블 화면과 공유되는 점을 고려해야 한다. 논리/물리 모드별 경로도 별도 키가 아니다.
- 메모가 scene.nodes에 포함되므로 현재는 메모도 장애물이다. 정리 범위와 숨긴 카드/메모 처리 정책을 명시해야 한다.

## 5. 일괄 적용, 실행 취소, 비동기 저장

- NativeERDCanvas.tsx:saveCommands/routeSave와 NativeProjectView.tsx:save → enqueueNativeSave → scheduleFlush의 저장 흐름을 재사용할 수 있다.
- native-save-intents.ts는 먼저 로컬 저장하고 이후 서버로 보내지만 NativeProjectView.save가 반환하는 Promise는 ACK 완료를 기다린다. 계산 UI 종료 시점을 이 Promise에 직접 묶으면 요구에 맞지 않는다.
- native-local-projection.ts의 projectNativeLocalColumns는 컬럼/테이블/키/FK 변경 등을 지원하나 relation layout 명령은 지원하지 않는다. 자동 배치 결과의 ACK 이전 표시와 실패·충돌 복구를 추가해야 한다.
- native-edit.ts는 요청당 명령 수 100개로 제한한다. 관계당 upsert 한 개를 쓰면 100개 초과 대량 정리에 문제가 생긴다.
- native-sync.service.ts의 트랜잭션과 native-history.service.ts의 sourceOperationId 기반 되돌리기는 재사용 기반이다. 임의로 여러 요청으로 나누거나 groupId만 같게 준다고 한 번에 원자적 적용/취소가 보장되는 것은 아니다.
- 권장 검토: 크기 제한이 있는 관계 경로 일괄 명령으로 한 작업 단위를 유지하거나, 명시적 대량 작업/히스토리 그룹 기능 설계. 기존 제한을 무작정 올리지 않는다.
- Worker 입력과 완료 시점의 관계/카드 크기·위치/뷰/모드/문서 revision을 비교해야 한다. 카메라 이동은 입력 변경으로 보지 않고, 원격 편집은 결과 폐기 또는 재계산 대상으로 취급한다.

## 6. 메뉴와 진행 UI

- NativeERDCanvas.tsx의 auto-layout 메뉴는 arrangeVisibleNodes를 즉시 호출하며 nativeAutoLayoutPlacements로 테이블 배치를 수행한다. 기존 테이블 배치 액션은 하위 메뉴로 옮겨 재사용한다.
- components/ui/index.tsx의 ContextMenuItem은 onAction 필수이고 children이 없다. 항목 액션 후 항상 닫히므로 메뉴 데이터·열림 상태·포커스/방향키·바깥 클릭 판정 확장이 필요하다.
- 기존 ui-menu-item 스타일을 재사용해 테이블 배치/관계선 배치 두 행을 구성한다. 호버/클릭, 오른쪽 공간 부족 시 반대편 열림을 지원해야 한다.
- 신규 작업 상태: 준비/계산/로컬 적용/완료/취소/실패. 캔버스 외부 UI 레이어에서 스피너·취소·status 안내와 progress 커서를 표시한다. 계산 중 이동·줌 허용, 구조·배치 편집 제한.
- 진행 UI는 일정 지연 후 표시하고 완료 결과는 한 번에 적용한다. 취소는 계산에만 적용하고 저장 이후 실행 취소와 구분한다. 저장 상태는 기존 UI를 이용한다.

## 7. Worker 및 검증

- apps/web/src 검색에서 new Worker 실행 기반은 발견하지 못했다. model의 경로 계산은 DOM/React import가 없어 순수 계산 재사용이 가능하다.
- nativeCanvasScene 함수 자체는 TSX 컴포넌트 파일에 있다. 그대로 Worker에 가져오기보다 가벼운 직렬화 입력 DTO를 만들거나 순수 scene 준비 로직을 분리한다.
- Worker 프로토콜(jobId, inputs, progress, result, error), 종료/취소, 오래된 결과 무시, 화면 전환/unmount 정리가 신규 필요하다. 동기 탐색 중 cancel 메시지만 보내면 즉시 처리되지 않으므로 Worker 종료 또는 분할 계산을 설계한다.
- Worker는 계산 중 UI 멈춤을 줄일 뿐, 결과 직렬화·로컬 저장·적용 시 React 렌더링 비용까지 없애지는 않는다. 결과 적용 시간도 따로 측정해야 한다.
- 기존 routing/adversarial/manipulation/native-route-edit/route-bend 테스트를 재사용한다. 새 검증은 endpoint 균등 간격, 혼잡 시 다른 면 분산, 순서 독립성과 재실행 안정성, 자기참조/복합 FK/중복 관계, 장애물 침범과 교차·중첩 길이, 대량 원자성·undo·오래된 결과·취소·ACK 실패를 다룬다.
- 실제 문서 및 규모별 fixtures로 계산 시간/최대 UI 정지/적용 시간/간격 위반/중첩 길이/교차 수/우회율을 측정해야 한다. 이번 조사는 실행 시간이나 개선 품질을 실측하지 않았다.

## 권장 다음 결정 순서

1. 모든 관계선의 범위를 전체 테이블 뷰로 할지 현재 필터로 할지, 공유 경로에 미치는 효과 확정.
2. 100개 초과 관계선의 한 작업 저장·실행 취소 방식과 로컬 즉시 표시 계약 설계.
3. 카드 경계 DTO와 포트 배정/통로 분리 순수 알고리즘을 작은 fixture로 검증할 계획 수립.
4. Worker와 UI 통합 후 실제 문서에서 품질·응답성 측정. 이 문서는 구현 승인이 아니라 조사 결과다.
