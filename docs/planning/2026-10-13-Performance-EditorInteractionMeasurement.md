# 편집기 버튼 및 저장 준비 직접 계측 계획

- 기준: 로컬 main 1fa6b08, 실제 Chrome localhost:3001(41 테이블). 실제 문서에는 저장 요청을 보내지 않는다.
- lab에 main 고유 제품 커밋 3092869/1fa6b08을 반영하여 제품 구현을 맞춘다.
- 격리 fixture에서 저장 없는 패널/컬럼 버튼을 profiling 빌드로 실행하고 React commit·하위 컴포넌트·함수 span과 frame callback 지연을 기록한다.
- 서버와 분리한 메모리 Storage로 enqueueNativeSave 비용을 측정한다. 네트워크/서버 ACK 시간은 이 수치에 포함되지 않는다.
- 원시 결과는 artifacts/performance에 보관하고 코드상 후보와 실측 사실을 분리하여 보고한다.
