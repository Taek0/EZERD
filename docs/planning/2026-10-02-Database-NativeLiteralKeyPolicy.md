# C6 native literal·key 정책 계획

- 기준: HEAD `79ae574`, 루트 AGENTS, [기능 명세](2026-10-01-Database-CapabilitySpecification.md), [타입 명세](2026-10-01-Database-TypeFeatureMatrix.md), [진행 기록](../work-log/2026-10-01-Database-ImplementationProgress.md).
- 담당: 새 `literals.ts`/`key-policy.ts`와 테스트, `validation.ts`, 전용 실제 엔진 QA 스크립트, 이 계획과 작업 로그. model index/catalog/features/native-document/contracts/DDL/UI/sync는 수정하지 않는다. 커밋과 full check는 main 담당이다.
- 순수 `literalDecision`/`keyEligibility` API를 만들고 엔진 허용·조건·진단과 제품 usable/coverage false를 분리한다. 타입 ID 없는 AST typedText를 임의 cast로 승인하지 않는다. AST 구조·참조 검사는 별도로 유지한다.
- 기본값 종류/형식/정수 폭/소수 정밀도/문자·바이너리·비트 길이와 날짜·UUID·네트워크·geometry·range·OID 제한 형식을 검증한다. 미지원 parser와 환경 객체 조회는 명시 unsupported/environment 오류다. none/null 지원을 특수 literal 지원 완료로 취급하지 않는다.
- PG builtin default btree opclass와 MySQL InnoDB 직접 PK/UNIQUE 제한을 키·unique btree 인덱스에 공통 적용한다. 신뢰한 previous 원문 fingerprint를 통한 복구와 read/write/export 의미를 유지한다.
- 실제 QA: 설정 PG URL localhost 검증 → UUID 전용 schema BEGIN/ROLLBACK; node:sqlite 메모리; MySQL 전용 컨테이너 label/network none/공개 port 없음/공식 8.4.11 및 아래 후속 승인된 정확한 익명 mount 조건 확인 후 제한 docker exec. PG65/MySQL37 기본 선언/PK/UNIQUE 및 고급 literal 왕복·오입력 거부 결과를 작업 로그에 기록한다.
- 담당 파일 targeted tests/typecheck/Prettier 실행 후 main에 export·소비 연결 필요사항과 독립 단위 ready를 보고한다. docs/EZERD.txt와 외부 채팅은 건드리지 않는다.
- 2026-10-02 후속 승인: official MySQL Dockerfile VOLUME으로 생성된 작업 소유 익명 volume `b64d418edfbd16b0ba710dfb9d9c65b4034dbf59b3da1967756602d88cbfb1d1`의 `/var/lib/mysql` mount만 정확한 containerID `032eb46e01d610cd0bfbad6127cff0ff47a3c3be648f0a67f3de101d3ecbc282`에서 허용한다. 다른 mount, network/port 노출은 거부한다. QA는 UUID DB만 생성/정리하며 최종 컨테이너·volume 정리는 main 담당이다. main이 public model index export를 연결하므로 QA 스크립트의 정책 import도 public API로 바꾼다.
