# 현재 코드 ERD 생성 결과

- EZERD MCP를 통해 TY 공간에 `EZERD 코드 ERD · 2026-09-30` 프로젝트 생성.
- 프로젝트 ID: `169ab1bb-b2e7-4db7-8112-f927ec4c3334`.
- 원본: `apps/server/src/db/schema.ts`. DB 접속이나 실제 데이터 조회 없이 Drizzle 메타데이터를 추출했다.
- 결과: 도메인 5개, 테이블 17개, 컬럼 122개, PK/UNIQUE 키 22개, 물리 FK 24개, ENUM 5개.
- 인증·공간·프로젝트·리뷰·동기화 화면과 `전체 물리 ERD` 결합 화면 제공.
- JSONB 내부 객체는 물리 테이블로 분해하지 않았다. 감사 로그의 ID 컬럼은 원본에 FK가 없어 관계를 만들어 넣지 않았다.
- 일반 인덱스, 부분 유일 인덱스, CHECK는 테이블 customProperties.physical에 기록했다. 부분 유일 인덱스는 전체 행 UNIQUE로 잘못 변환하지 않았다.
- `artifacts/repository-erd/ezerd-project.json`은 재가져오기 가능한 원본 산출물이다.
- `artifacts/repository-erd/schema.sql`은 EZERD 모델에서 내보낸 참고 DDL이다. 메타데이터로 보존한 일반/부분 인덱스 및 CHECK는 DDL에 포함되지 않으므로 마이그레이션 대체용이 아니다.

## 재생성

레포 루트에서 실행한다. 하위 폴더에서는 현재 nvm 설정이 Node 버전을 찾지 못하므로 루트를 기준으로 실행했다.

```powershell
node --import ./apps/server/node_modules/tsx/dist/loader.mjs apps/server/scripts/export-repository-erd.mjs artifacts/repository-erd
```

## 검증

- 모델의 PostgreSQL exporter: diagnostics 0건, canExport 통과.
- MCP get_project_summary: 테이블·컬럼·키·관계 개수 일치.
- MCP get_project_view: 7개 화면 전체 재조회, 카드 사이 최소 40px 간격 위반 0건.
- MCP list_view_relations: 전체 물리 ERD에 FK 24개 확인.
- 카드 크기는 실제 tableCardMetrics로 계산했다.
- pnpm format 적용 및 pnpm format:check 확인.
- docs/EZERD.txt 및 애플리케이션 동작 코드는 변경하지 않았다.
