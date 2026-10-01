# C2g native 참조 ID 재매핑 결과

- 기준: [계획](../planning/2026-10-01-Database-NativeIdentityRemap.md), 시작 `7658685`.
- domain/view/note/ENUM/table/column/key/FK/index/check와 node/viewport/route의 명시 ID/참조를 재매핑한다. 생성식·기본값·onUpdate·index parts/predicate/include·CHECK AST 컬럼을 모두 처리한다.
- SQL 타입 ID·function ID·이름·주석·리터럴·customProperties·sequence 숫자 문자열·legacy 원문은 변경하지 않는다. DB/profile을 보존한다. entity와 node의 원본 ID 문자열이 같아도 별도 mapping으로 구분한다.
- 누락/중복/예약 ID와 대상 entity-node 충돌을 거부한다. 외부 참조는 explicit retained ID 또는 그 ID로의 mapping만 허용한다. 새 노드가 retained identity를 덮어쓰지 못하게 한다. 실패 시 원본을 변경하지 않는다.
- 이 helper는 SQL 규칙/legacy provenance/복제 허가 검사와 별개다. clipboard consumer는 legacy와 다른 DB/profile을 차단하고 최종 merged 문서·예산·대상 모드를 검증해야 한다. 복원 consumer는 저장 history/원본 DB 문맥으로 권한과 원본을 검증한 뒤 사용해야 한다. 아직 그 소비 경로를 활성화하지 않았다.
- **6개 테스트 통과**: 전체 참조 graph와 PG/Mysql/SQLite 옵션의 AST remap, 동일 문자열의 type ID/리터럴 보존, 2^53 초과 숫자/sequence 문자열, legacy 원문, 참조 허용 범위, 누락/중복/충돌 및 source/optional 필드 보존을 확인했다. mapper 테스트는 구조 처리 테스트이며 SQL 실행 검증은 아니다.
- 최종 `pnpm check`: 전체 포맷/타입/테스트/빌드 통과, **743개 통과/44개 건너뜀**. live v2/API 저장/화면/DDL 활성화는 하지 않았다.
