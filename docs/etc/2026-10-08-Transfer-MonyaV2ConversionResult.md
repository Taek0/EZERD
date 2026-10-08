# Monya 프로젝트 v2 JSON 변환 결과

- [계획](2026-10-08-Transfer-MonyaV2ConversionPlan.md)에 따라 사용자가 제공한 Monya v1 파일을 PostgreSQL Native v2 전송 파일로 변환했다. 원본 Downloads 파일은 변경하지 않았다.
- 결과는 [Monya.v2.ezerd.json](../../.cache/exports/Monya.v2.ezerd.json)이다. formatVersion과 document.schemaVersion은 2이며 DB 문맥은 postgresql/postgresql-18-v1이다. .cache는 Git에서 무시되므로 사용자 설계 JSON은 커밋하지 않는다.
- 테이블 6개, 컬럼 31개, 도메인 1개, 키 7개, 테이블 관계 6개, ENUM 2개를 유지했다. ID·논리 정보·사용자 속성·관계 정의·ENUM 값·뷰/메모·레이아웃과 좌표는 원본과 비교해 보존을 확인했다.
- 공식 migrateDesignDocumentV1로 namespace·타입·generation/defaultValue/options를 Native 구조로 변환했다. 지정된 30개 컬럼 타입, ENUM 참조 및 문자열/시간 기본값도 Native 형식으로 변환됐다.
- contents.content_type은 원본의 타입 이름이 비어 있고 설명도 타입 미정이라고 명시돼 있다. 임의의 text/ENUM 타입을 지정하지 않고 Native가 지원하는 legacy 원문 보존 형식을 사용했다. 이에 대한 legacy.type-unresolved 진단 1개는 남으며, 완전한 물리 DDL 내보내기에는 해당 타입 지정이 필요하다. 현재 가져오기 정책은 검증된 원문이므로 허용한다.
- nativeProjectTransferSchema, nativeTransferReadSchema, nativeStoredDesignDocumentSchema와 canonical 비교·참조 그래프·실제 Native import provenance/write 정책을 통과했다. 새로운 가져오기 정책 오류는 0개다.
- 임시 Vitest 검증에서 실제 NativeTransferService와 기존 메모리 저장소 adapter로 결과 파일을 가져왔다. 문서 v2·DB/profile·객체 개수·참조·미정 타입 보존·감사 원문·입력 불변을 확인했으며 1개 테스트가 통과했다. 임시 테스트 소스는 제거했고 실제 사용자 DB/MCP에는 쓰지 않았다.
- 파일 저장 후 다시 JSON을 읽어 계약을 재검증하고 원본 바이트가 그대로인지 확인했다. 결과 크기는 49,731바이트다.
- 원본 SHA-256: ed2a0a5dffc3d496a54bce37823ca3b9f5869e92615301232014fd34f2c7122e.
- 결과 SHA-256: daf840f27f979da501cc0a434809b61223f5f75c2bf6a23c074f54c9ec5d59cb.
- 변환/검증 스크립트와 상세 진단은 같은 .cache/exports/에 로컬로 보존했다. 제품 코드를 변경하지 않았으며 동시에 진행 중인 편집기 개선 변경은 이번 작업과 무관하다. docs/EZERD.txt도 변경하지 않았다.
