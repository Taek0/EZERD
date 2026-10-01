# Native 후보의 legacy 원본 보존 경계

- 시작 `bb40e2f`. 서버 native 후보 소비를 준비하며 공통 write 정책에서 논리 전용 객체의 legacy 복제와 같은 ID 컬럼의 소유 테이블 변경이 기존 오류 비교를 피할 수 있음을 확인했다.
- [전체 명세](2026-10-01-Database-CapabilitySpecification.md)의 신규 legacy 금지와 trusted previous 규칙을 모든 scope에 적용한다. 기존 물리 DB 진단을 생략하는 논리 객체도 legacy 입력의 출처 검사를 생략하지 않는다.
- 같은 DB/profile의 서버 저장 이전 문서에서 동일 ID·동일 소유 테이블의 동일 raw legacy type/default, 동일 테이블 ID의 동일 raw namespace만 유지할 수 있다. 원문 변경·새 ID 복제·다른 소유 테이블 이동·클라이언트 previous 대체는 허용하지 않는다. 설명/레이아웃 수정·legacy 삭제/교체는 기존 복구 정책을 유지한다.
- 공통 model write 검증에 출처 검사를 추가해 REST/MCP/sync/clipboard의 후보 정책이 일치하게 한다. read/export의 scope 의미는 바꾸지 않는다. 서버 소비 helper는 잠긴 행의 previous를 전달해야 하며 이번 단위에서 live v2 쓰기를 열지 않는다.
- 논리 전용 type/default/namespace 신규 생성·복제, 기존 유지, 원문/소유자/DB 변경 및 정상 교체를 의미 있는 테스트로 검증하고 전체 check/기록/독립 커밋한다.
