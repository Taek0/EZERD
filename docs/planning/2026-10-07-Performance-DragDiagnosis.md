# 캔버스 드래그 경로 검증 계획

- 현재 main checkout 소스를 읽어 영역 선택과 테이블 이동의 고빈도 처리 경로를 확인한다.
- main에 진행 중인 BlankClickFreeze 문서/테스트가 있으므로 이를 수정하거나 커밋하지 않는다.
- lab에서 실제 소스의 pointer handler를 추출 실행하여 동일 선택 반복 갱신과 lostpointercapture 종료를 검증한다. 이 검증은 React 전체 렌더 또는 브라우저 FPS 계측을 대체하지 않는다.
- localhost:3001은 응답하지만 검증 브라우저는 로그인 화면이다. 사용자 계정 생성/로그인이나 실제 문서 변경 없이 검증한다.
