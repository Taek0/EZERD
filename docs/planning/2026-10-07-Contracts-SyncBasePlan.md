# 공통 동기화 계약 분리

- sync.ts에 섞인 공통 actor/path/change/sequence/baseline/메타데이터 필드와 v1 문서 envelope를 분리한다.
- Native 입력·응답은 공통 필드와 Native 문서 스키마로 직접 구성하고 v1 envelope를 extend하지 않는다.
- 과거 v1/v2 입력·결과·이벤트를 해석하는 union reader는 별도 모듈로 옮긴다. Native 이력·취소 ACK 읽기는 이 reader를 명시적으로 사용한다.
- 패키지 public export와 기존 sync.ts 경로의 이름은 유지한다. 내부 native-sync.ts의 reader import는 새 읽기 모듈로 옮겨 순환 의존성을 만들지 않는다.
- strict 필드, 기본값, 크기/순서 한도, 중복 경로, DB 문맥·revision 검사 및 파싱 결과를 유지한다. v1 API를 다시 열지 않는다.
- 포맷·타입·전체 테스트·빌드와 격리 DB의 Native 저장/이력/취소 회귀를 검증 후 커밋한다. 사용자 DB·docs/EZERD.txt는 변경하지 않는다.
