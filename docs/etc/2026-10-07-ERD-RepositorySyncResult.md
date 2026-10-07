# 레포 기준 EZERD 프로젝트 동기화 결과

- 대상: TY 공간 `ezerd`, 프로젝트 ID `903ec4ff-2ca4-4724-8d8a-3ec98765a68b`.
- 기준: `apps/server/src/db/schema.ts`의 Drizzle 런타임 메타데이터. 운영 DB가 아니라 레포와 ERD를 대조했다.
- 완료 상태: native v2, version 70, sequence 71. 스키마·배치 적용 ACK 모두 accepted.
- [계획](2026-10-07-ERD-RepositorySyncPlan.md)

## 수정 사항

- 테이블 17 → 19: `project_database_operations`, `native_request_cancellations` 추가.
- 컬럼 121 → 142: 신규 테이블의 17개 컬럼 및 `projects.database_kind/database_profile_id/database_revision`, `sync_client_baselines.database_revision` 추가.
- FK 24 → 28: 두 신규 테이블의 프로젝트·수행자 참조 추가. 기존 FK의 대상·삭제/갱신 규칙은 일치했다.
- `project_database_kind` ENUM 추가. 컬럼 순서를 레포 정의에 맞췄다.
- PK/UNIQUE 22개, 실제 인덱스 16개, CHECK 1개 반영. 세션·MCP 토큰의 토큰 해시 유일성은 레포와 동일하게 UNIQUE 제약 대신 UNIQUE 인덱스로 표현했다.
- 기존 객체 ID, 논리명과 설명을 유지했다. 프로젝트·동기화 참조 안내 메모도 갱신했다.

## 계층 배치 및 검증

- 공유 테이블 화면에 전체 19개 테이블 배치. 도메인 화면은 같은 공유 좌표를 사용한다.
- 사용자·공간 → 인증/멤버십/프로젝트 → 프로젝트 작업·개인 상태·동기화·리뷰 스레드 → 댓글·알림 순으로 왼쪽에서 오른쪽으로 정렬했다.
- 동기화 테이블들은 프로젝트의 같은 하위 계층이다. 감사 이력은 원래 설계대로 물리 FK 없이 유지했다.
- 실제 native 카드 크기 계산 함수를 사용하고 같은 계층의 폭을 통일했다.
- 28개 FK에 경로와 앵커를 지정했다. 건너뛰는 계층의 관계선은 카드 바깥 통로로 우회한다.
- 최종 저장 문서를 재조회하여 카드 간격 40px 미만 0건, 관계선의 다른 카드 관통 0건, 부모→자식 역방향 0건, native 진단 0건 확인.
- 레포 비교 스크립트 재실행 결과 추가 스키마 명령 0개, 추가 배치 명령 0개.
- `pnpm format`, `pnpm format:check` 통과. 제품 런타임 코드를 수정하지 않아 전체 제품 테스트는 실행하지 않았다.

## 표현 제한

다음 세 항목은 native 표현식 정책이 지원하지 않아 원문 SQL을 해당 테이블의 `customProperties.physical`에 보존했다. 공유 화면 안내 메모에도 표시했다. 따라서 이 ERD의 DDL 내보내기를 전체 마이그레이션 대체물로 사용하면 안 된다.

- `users_username_normalized`: `btrim` 함수 미지원.
- `projects_database_profile_matches`: ENUM과 문자열의 비교 미지원.
- `workspace_invitations_pending_unique`: ENUM 조건의 부분 UNIQUE 인덱스 미지원.

`get_project_view`와 `list_view_relations`는 native v2에서 클라이언트 갱신 오류를 반환했다. `get_project_document_state`의 원본 저장 좌표·관계로 동일한 수치 검증을 수행했다. 브라우저 시각 검증은 수행하지 않았다.

## 재검증 및 산출물

```powershell
node --import ./apps/server/node_modules/tsx/dist/loader.mjs apps/server/scripts/compare-repository-erd.mjs artifacts/repository-sync-2026-10-07 final.json
```

- [비교 스크립트](../../apps/server/scripts/compare-repository-erd.mjs): 오프라인 비교 전용. MCP 변경은 자동 수행하지 않는다. 현재 레포의 테이블 분류와 지원되지 않는 표현식을 명시적으로 다룬다.
- [변경 전 원본](../../artifacts/repository-sync-2026-10-07/before.json)
- [최종 원본](../../artifacts/repository-sync-2026-10-07/final.json)
- [스키마·배치 적용 명령](../../artifacts/repository-sync-2026-10-07/applied-commands.json)
- [관계선 명령](../../artifacts/repository-sync-2026-10-07/route-commands.json)
- [레포 재비교 결과](../../artifacts/repository-sync-2026-10-07/report.json)
- [최종 좌표·native 검증](../../artifacts/repository-sync-2026-10-07/verification.json)

`docs/EZERD.txt`는 수정하지 않았다.
