# ERD 표현 적합성 점검 결과

- [계획](2026-10-21-ERD-RepresentationAuditPlan.md)
- 기준: 레포 `f365cb1`, ezerd version 83. 운영 DB 직접 조회가 아니라 현재 레포와 저장된 ERD를 비교했다.
- 결론: 물리 DB 구조는 정확히 표현한다. 프로젝트 전체를 설명하는 자료로는 JSONB 내부 설계 모델, 일부 테이블 설명 및 선 가독성 보완이 필요하다.

## 정확성

- schema.ts는 이전 반영 커밋 ba9c845 이후 물리 구조 변경 없음.
- 재비교에서 수정 명령 0개. 17개 테이블, 132개 컬럼, 24개 FK, 키 20개, native 인덱스 15개, native CHECK 2개.
- 인증·워크스페이스·프로젝트·리뷰·동기화의 5개 도메인 사이 FK를 집계한 결과 도메인 관계 7개와 일치. 누락/불필요한 도메인 연결 없음.
- 프로젝트 설계 객체는 projects.document JSONB 안에 저장된다. README 및 NativeDesignDocument/DocumentBase 타입과 일치한다. JSONB 내부의 도메인·테이블·컬럼·키·관계·배치가 물리 DB 테이블로 없는 것은 정상이다.
- workspace_audit_events가 FK 없이 감사 식별자를 보존하는 표현도 schema.ts 의도와 일치한다.

## 개선 사항

1. **관계선 가독성**: diagnose_layout physical에서 24개 경로 전부 검사(coverage.complete=true, truncated=false). 교차/접촉 46건, 동일 선분 중첩 1건. 카드 겹침·간격 부족(40px 기준)·카드 관통은 보고되지 않음. 200px 권장 간격이나 브라우저 시각 검증 통과를 의미하지 않는다.
   - 중첩 관계: user_workspaces_user_id_users_id_fk와 workspace_invitations_invited_user_id_users_id_fk.
   - 공통 구간: y=-52, x=2654~2670 (16px).
   - 도메인 관계 경로는 diagnose_layout 지원 범위 밖이므로 이번 결과에 포함하지 않았다.
2. **테이블 설명**: project_database_operations와 native_request_cancellations의 논리명이 물리명 그대로이고 definition은 모두 '현재 레포 스키마에서 추출'이다. 각각 DB 변경 작업의 중복 처리 방지 기록과 취소 요청 차단 기록임을 설명하는 것이 좋다. 두 테이블의 역할은 workspace/project-database.service.ts와 sync/native-cancellation*.ts에서 확인했다.
3. **프로젝트 핵심 모델 설명**: 현재 그림은 인증·협업·저장·동기화 인프라를 잘 보여주지만 핵심 설계 문서 구조는 JSONB 컬럼 한 개로만 표현된다. 별도 논리 모델/메모로 NativeDesignDocument의 domains/tables/columns/keys/indexes/checks/tableRelations/layout을 연결해 설명하면 이해가 쉬워진다. 물리 테이블로 추가하는 것은 부정확하다.
4. **DDL 완전성 제한**: users_username_normalized, projects_database_profile_matches CHECK 및 workspace_invitations_pending_unique 부분 UNIQUE 인덱스는 native 표현식 지원 제한으로 메타데이터 SQL에만 보존된다. 현재 ERD DDL만으로 전체 DB 제약을 재현할 수는 없다.

## 수행 범위

- 확인 요청에 따라 원격 ERD·배치·메모·제품 코드는 변경하지 않았다.
- 기존 비교 스크립트를 .data/erd-audit-2026-10-21에 대해 실행했다. 임시 스냅샷/결과는 Git 제외 경로에 저장했다.
- 문서만 추가하여 제품 테스트/포맷 변경은 수행하지 않았다. docs/EZERD.txt는 수정하지 않았다.
