# C2h native clipboard envelope와 copy/paste 소비

- 시작 `3eede22`, 작업 트리 깨끗함. [전체 명세](2026-10-01-Database-CapabilitySpecification.md)의 native clipboard 단위다.
- `ezerd/tables` formatVersion 2와 sourceDatabase/profile, self-contained native fragment를 정의한다. 기존 `ezerd/tables-v1`은 원본을 읽되 새 native paste에서 출처 DB를 추측하지 않는다. 2 MB envelope/1.5 MB 문서 및 AST 예산을 적용한다.
- 선택된 테이블/소유 컬럼·key/index/check/필요 ENUM/선택 내부 FK와 좌표를 복사한다. 외부 FK는 제외 목록을 제공한다. domain/private view/메모/카메라를 복제하지 않고 fragment는 미소속/global table canvas로 만든다.
- paste는 같은 DB/profile에서 fresh entity/node ID를 할당하고 새 domain/좌표를 적용한다. 새 legacy 복제, 누락 참조, ID 충돌과 잘못된 namespace/모드/SQL 규칙을 거부한다. ENUM은 동일 schema/name/values일 때만 기존 정의를 재사용한다. 새 이름은 DB 식별자 길이 안에서 충돌을 피한다.
- 전체 merged 후보의 구조/예산을 검증하고 기존 target를 previous로 native write 정책을 계산한다. 결과는 준비 계획(candidate/IDs/issues/canApply)이며 현재 unverified native 기능은 적용 가능으로 표시하지 않는다. 테스트를 위한 정책 bypass 옵션은 만들지 않는다.
- v2 화면이 아직 준비되지 않았으므로 현 v1 clipboard/event 저장을 바꾸지 않는다. 실제 UI/서버 native 소비 시 이 계약/helper와 잠긴 행 기준 검증을 함께 사용한다. 원본 보존/DB·legacy 차단/AST remap/기존 데이터 문제/용량/조건을 검증하고 독립 커밋한다.
