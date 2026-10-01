# C2e/C3 native 동기화 전송 계약

- 시작 `28b387b`, 작업 트리 깨끗함. 실제 v2 쓰기는 여전히 비활성이다.
- v1 sync envelope는 수정하지 않고 native `protocolVersion: 2` 입력/result/event와 versioned reader를 추가한다.
- v2 입력에는 database/profile/revision이 필수다. baseline/candidate의 문서 DB 문맥이 envelope와 일치해야 한다. native 구조/문서 예산/AST 예산 검사를 재사용하며 파싱으로 원본 diff/fingerprint를 정규화하지 않는다.
- accepted 결과의 next baseline은 현재 revision과 일치하고, rejected 결과는 이전 baseline revision을 보존할 수 있다. 결과 문서가 있으면 결과 DB와 일치해야 한다.
- 서버가 받은 context/revision은 주장일 뿐이며 row lock 아래 저장된 프로젝트/발급 baseline/원본 legacy와 비교해야 한다. 계약 추가만으로 기존 v1 endpoint가 v2를 받게 하지 않는다.
- 위조 actor/DB 불일치/이전 프로토콜 혼용/원본 보존/재시도 형식 및 의미 있는 테스트 후 전체 검증과 독립 커밋을 수행한다.
