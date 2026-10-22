# 캔버스 후속 최적화 후보

기준: performance-lab c38e4cc, main 0e901fd 포함. 정적 코드 확인이며 이번에는 브라우저 FPS/React profiler/시간 측정을 수행하지 않았다. 제품 코드는 수정하지 않았다.

1. 화면 팬: NativeERDCanvas.tsx:764의 setCamera가 React state를 즉시 갱신하며 :2414 pointermove에서 호출한다. scene memo는 카메라와 분리돼 전체 라우팅이 매번 실행되는 것은 아니다. 먼저 rAF로 프레임당 최신 좌표 한 번만 반영하고 종료 좌표 flush를 검토한다. 고배율/저배율 포인터 기준 줌, 마지막 위치, 취소와 캡처 해제를 검증해야 한다.
2. hover: NativeCanvasScene.tsx:122의 hoveredRelationId가 부모 내부 렌더를 유발하고, :158 NativeTableLines는 memo가 없어 전체 SVG 설명을 다시 생성한다. NativeTableLines.tsx:59부터 table/column find를 모든 관계에 반복한다. 별도 memo 경계와 콘텐츠 기반 lookup/tooltip 사전 계산을 권장한다. 행 하이라이트의 기존 Set 참조 재사용은 유지한다.
3. 셀: NativeCanvasInlineCell.tsx:57의 table/column find 뒤 :62 nativeInlineInput이 같은 조회를 반복하고 편집 가능 셀은 :94에서 다시 해석한다. 기존 row.column/table 전달과 해석된 입력 공유로 중복 탐색을 줄일 수 있다. 초안·포커스·권한·최신 저장 기준은 유지해야 한다.
4. 탐색/속성 패널: NativeProjectView.tsx:1074–1156의 outline, selectedRows, navigatorColumns, 검색 파생 값이 렌더마다 다시 계산된다. 문서/모드/범위 기반 파생값과 검색 필터를 분리해 memo하고 table/domain/column 인덱스를 공유한다. 변경 시 새 값 반영을 검증한다.
5. 카드 배치 draft: NativeERDCanvas.tsx:393에서 전체 scene을 다시 생성하고 :335에서 모든 표시 관계에 일반 relationGeometry를 호출한다. 관계마다 obstacles 배열도 새로 만든다. dirty endpoint와 이동 전후 카드 사각형에 영향을 받는 경로를 찾아 재사용하는 것은 효과가 클 수 있으나 장애물 영향 범위를 누락할 위험이 크다. 연결된 관계만 갱신하는 방식은 안전하지 않다. 먼저 장면/라우팅 시간 실측 후 별도 설계한다.
6. 큰 도면의 DOM: NativeCanvasScene.tsx:173에서 모든 표시 노드가 mount된다. CSS content-visibility는 이미 적용돼 있으나 React 컴포넌트 수 자체를 줄이지 않는다. 실제 DOM/paint 병목이 확인될 때만 viewport overscan과 focus/draft/pin 유지 규칙을 갖춘 culling을 검토한다.

그룹 장면 중복 제거, 카드 콘텐츠 치수 공유, memo 행/장면, 영역 선택 frame 병합, 패널 resize preview, 자동 배치 Worker와 자동 정리 탐색 개선은 이미 적용됐다. 자동 정리 0.9초 결과를 일반 이동 성능으로 확대 해석하지 않는다. 과거 저배율 화면 깨짐과 관련된 world 강제 레이어 승격을 재도입하는 방향은 권하지 않는다.

권장 실행 순서: 팬 프레임 병합 및 관계선 hover → 셀/탐색 패널 반복 조회 → 실측에 근거한 부분 경로 갱신 → 필요 시 화면 밖 렌더링 제어. 각 항목의 체감 개선율은 아직 확정하지 않았다.
