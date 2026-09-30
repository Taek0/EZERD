# 프로젝트 DB 설정 저장과 동기화 문맥 보호

- 기준: [서버 정책 계획](../planning/2026-10-01-Database-ServerPolicyImplementation.md), C2c/C3b의 설정 저장·구문맥 보호 부분.
- 프로젝트에 profile ID와 변경 번호를 저장한다. 0014 마이그레이션은 기존 DB 표시별 프로필을 채우고 설계 JSON은 변경하지 않는다. DB 종류/프로필 조합과 음수 변경 번호는 DB 제약으로 차단한다.
- `database/preview`, `database/change`는 현재 버전·선택적 편집 순서·DB 변경 번호를 확인한다. 변경 API는 프로젝트 행을 잠그고 작업 ID/작성자/요청 fingerprint로 재시도를 보존한다. DB 변경과 baseline 폐기·감사 기록은 한 트랜잭션에 있다. 물리 객체가 있으면 변환 전 변경을 차단한다. 논리 객체만 있는 프로젝트는 허용한다.
- 기존 카드 PATCH도 같은 물리 설계/프로필/변경 번호 보호를 갖는다. 이름+DB 변경은 기존 단일 트랜잭션을 유지한다. 설정 전용 변경 API는 커밋 후 WS head를 발행한다. 기존 PATCH 변경은 주기적 head/HTTP polling으로 감지된다.
- 새 sync 작업/baseline/result/event에 DB 변경 번호를 연결한다. 오래된 요청에 필드를 기본 주입하지 않아 fingerprint 재생을 보존한다. 누락 번호는 최초 문맥 0으로 판단한다. 신뢰할 수 있는 저장 baseline 번호도 확인하므로 요청 번호만 위조할 수 없다.
- baseline 발급은 프로젝트 share lock 아래 수행한다. undo/restore는 원본 작업 문맥을 확인하고 적용 시 재검사한다. MCP는 baseline 번호를 쓰기에 전달하고 선택적 예상 번호를 검증한다. revision 필수화는 native MCP 연결 단위에서 이어간다.
- 브라우저는 편집 순서가 같아도 head/빈 event 응답의 번호 변경을 감지하고 편집을 잠근다. 이전 큐는 원본 번호를 보존하며 다른 문맥으로 rebase/reapply하지 않는다. 과거 accepted replay가 현재 기준을 되돌리지 않는다. 원본 큐/현재 화면은 유지한다.

## 검증

- `pnpm check`: 전체 포맷/타입/테스트/빌드 통과. **704개 통과, 44개 건너뜀**.
- 격리된 로컬 PostgreSQL에서 전체 0~14 마이그레이션 + autosync 통합 **8개 통과**. 설정 변경 경쟁, 재시도 동일성/다른 요청 차단, 원본 JSON 보존, old pending 거부, 위조 번호 차단, undo 거부, 새 baseline 쓰기, 물리 설계 변경 차단/PATCH 우회 차단, backfill 및 DB 제약, archive 보호를 실행했다. 임시 DB는 종료 후 삭제했다.
- 브라우저 runtime 테스트 32개 중 신규 3개는 열기/baseline 경합, 편집 순서 없는 head 변경, 이전 durable 큐의 번호 보존/재적용 차단을 확인한다. 실제 브라우저 UX 검증은 C4에 남았다.
- 전체 격리 API/MCP 통합 실행에는 기존 실패 5개가 남는다. `fb66726` 별도 복사본에서도 같은 실패를 재현했다: API export/enum/메모 3개는 기존 테이블 캔버스 정규화와 fixture 기대가 다르며, MCP export metadata 기대 1개와 개인 combined view 관계 layout 1개다. 별도 복사본의 SPA 404는 그 복사본에 web/dist를 만들지 않은 환경 차이였다. 이번 단위의 성공을 전체 통합 성공으로 보지 않는다.

## 남은 범위

제품 저장/화면은 계속 v1이다. native 후보의 서버 최종 검증·업그레이드/import/전체 sync/clipboard/이력 소비, 카드 preview UI, capability MCP, native 편집과 DDL 연결은 다음 단위다. 물리 설계의 DB 변환은 아직 제공하지 않는다. 개발 DB에는 이번 마이그레이션을 적용하지 않았으며 격리 DB에서만 확인했다. `docs/EZERD.txt`와 선행 작업은 유지했다.
