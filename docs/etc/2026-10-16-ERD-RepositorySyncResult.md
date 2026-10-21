# 레포 변경 ERD 반영 결과

- [계획](2026-10-16-ERD-RepositorySyncPlan.md)
- 기준: 현재 schema.ts 및 마이그레이션 0016~0019, 작업 시작 HEAD `3e129d8`.
- 대상: TY / ezerd (`903ec4ff-2ca4-4724-8d8a-3ec98765a68b`). 최종 version 81 / sequence 82, native 변경 accepted.

## 반영

- `project_personal_states`, `project_personal_operations` 제거. 연관 컬럼 11개, FK 4개, PK 2개, 인덱스 1개 및 카드/경로를 함께 정리했다.
- `user_workspaces.sort_order` 추가: INTEGER, NULL 허용, 기본값 없음. 컬럼 순서도 레포와 일치.
- `user_workspaces_sort_order_nonnegative` CHECK를 실제 native CHECK로 추가했다.
- `project_database_kind` ENUM에 `generic` 추가. 프로젝트 자체의 PostgreSQL DB 설정은 유지했다.
- `projects_database_profile_matches` 메타데이터 SQL에 `generic-v1` 조건과 `::text` 비교를 반영했다.
- 개인 상태 기능 종료에 맞춰 인증·프로젝트·공간 메모 및 프로젝트 도메인 설명을 수정했다. 인증→프로젝트 관계는 실제 `project_database_operations.actor_id` 참조로 설명을 갱신했다. 동기화 관련 도메인 설명에 취소 이력 FK도 보완했다.
- 길어진 메모 3개의 높이만 늘렸다. 남은 테이블과 도메인 카드 좌표는 유지했다.

## 검증

- 재조회 후 스키마 비교 명령 0개, native 쓰기 검증 오류 0개.
- 최종 17개 테이블, 132개 컬럼, FK 24개, 키 20개, native 인덱스 15개, native CHECK 2개.
- `sort_order` 추가 후 카드에 필요한 높이 265px, 저장 높이 272px로 잘림 없이 유지 가능.
- 전체 저장 뷰의 카드/메모 사각형 검사: 40px 미만 간격 없음. 남은 테이블 배치 변경 없음.
- `get_project_view` / `list_view_relations` 재조회 성공, 다음 페이지 없음.
- `diagnose_layout` physical: coverage.complete=true, 24개 경로 검사. 카드 겹침/관통/선분 중첩 없음. 기존 전체 관계의 직각 교차 29건은 남으며, 이번 스키마 동기화에서 전체 재배치는 하지 않았다. 도메인 관계 경로는 이 진단의 지원 범위 밖이며 좌표를 바꾸지 않았다.
- 권장 간격 200px 및 수직 계층을 전체 재적용하지 않았다. 사용자가 앞서 요청한 가로형 배치를 유지했다.
- 기존 CHECK 2개와 부분 UNIQUE 인덱스 1개는 표현식 지원 제한 때문에 정확한 SQL을 메타데이터로 계속 보존한다.
- 제품 코드 변경 없음. 새 문서와 artifacts는 Prettier 제외 대상이며 전체 제품 테스트/포맷 변경을 수행하지 않았다. 진행 중인 Inspector 변경은 커밋에서 제외한다.
- 운영 DB 및 docs/EZERD.txt는 변경하지 않았다.

## 산출물

- [변경 전](../../artifacts/repository-sync-2026-10-16/before.json), [최종 원본](../../artifacts/repository-sync-2026-10-16/after.json)
- [전체 적용 명령](../../artifacts/repository-sync-2026-10-16/final-applied-commands.json)
- [재비교 결과](../../artifacts/repository-sync-2026-10-16/report.json), [배치 진단](../../artifacts/repository-sync-2026-10-16/layout-diagnostics.json)
- [배치 보존 비교 스크립트](../../artifacts/repository-sync-2026-10-16/compare.mjs)

```powershell
node --import ./apps/server/node_modules/tsx/dist/loader.mjs artifacts/repository-sync-2026-10-16/compare.mjs artifacts/repository-sync-2026-10-16 after.json
```
