# Native 후보 legacy 원본 보존 경계 결과

- [계획](../planning/2026-10-01-Database-NativeWriteProvenance.md). 공통 native write 검증에 scope와 무관한 `inspectNativeLegacyChanges`를 추가했다.
- 동일 DB/profile의 trusted previous에서 같은 객체 ID/컬럼 소유 테이블의 같은 raw legacy type/default, 같은 테이블 ID의 같은 raw namespace만 유지한다. 신규 복제·원문 변경·소유자 변경은 `legacy.source-not-trusted`로 차단한다.
- 설명/레이아웃 변경, legacy 삭제/정상 타입 교체는 유지한다. DB 엔진 규칙·read/export 정책은 그대로다. 클라이언트 supplied previous를 신뢰하는 API는 추가하지 않았다. 서버는 lock 아래 저장된 원본을 previous로 전달해야 한다.
- 새 테스트 4개(3종 logical-only 분기 및 소유자/문맥/정상 교체)가 기존 물리 복구 검사와 함께 통과했다. validation/clipboard 합계 32개 통과. 전체 `pnpm check`는 757개 통과/44개 건너뜀, 포맷·타입·빌드 통과. 큰 Vite 번들 경고는 기존 상태다.
- 다음 서버 native 소비 helper에서는 원본 reader, 프로젝트 문맥과 revision, raw sync claims, legacy 출처와 최종 merged 후보를 함께 검사한다. live v2 저장·실제 UI/DDL/SQL 실행 검증은 미완료다.
