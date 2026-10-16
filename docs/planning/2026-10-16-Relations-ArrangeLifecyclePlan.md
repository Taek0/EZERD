# 관계선 배치 수명주기 수정 계획

- 실제 localhost:3001이 제공하는 index-CR7v5ldy.js에 React 개발 런타임과 StrictMode가 포함되어 있음을 확인했다.
- NativeERDCanvas는 useMemo로 만든 컨트롤러를 effect cleanup에서 영구 dispose한다. StrictMode의 effect 재실행에서는 memo가 유지되어 이후 start가 조용히 반환한다.
- 현재 main과 격리 lab의 관련 캔버스/컨트롤러 파일이 동일한지 확인했다.
- 실제 React StrictMode에서 캔버스 메뉴 동작이 worker를 시작하는 회귀 테스트를 먼저 작성하고 실패를 확인한다.
- 컨트롤러 생성과 정리를 같은 layout effect에서 관리해 effect 재실행 때 새 인스턴스를 사용한다. 격리 lab에서만 수정하고 main/서버는 변경하지 않는다.
- 관련 테스트, 타입 검사 및 포맷 검증 후 결과를 기록한다. 상위 작업자의 통합 검토 전에는 커밋하지 않는다.
