# Native 보조 UI 카메라 재렌더 제거 계획

2026-10-06. 잔여 작업 통합 측정에서 100테이블 Native p95가40~50ms로 확인됐다. scene 계산은0회지만 PNG 버튼의 문서 fingerprint와 Clipboard 메뉴의 native source 검사 등이 부모 camera render마다 재실행되는 경로가 남아 있다. PNG/Clipboard/스타일/도메인/캔버스 action 보조 UI도 React.memo 기본 비교로 분리하고 context/명령 callback identity를 안정화한다. 권한·문서·선택·보관 상태가 변할 때는 props로 정상 갱신하고 비동기 최신 저장 guard를 유지한다. 같은 50/100테이블 read-only/편집표현/simple-cards 조건에서 재측정해 효과를 확인한다.
