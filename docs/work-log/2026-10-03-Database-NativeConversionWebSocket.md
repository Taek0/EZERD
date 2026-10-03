# Native DB conversion 실제 두 WebSocket 수신 QA

2026-10-03. [계획](../planning/2026-10-03-Database-NativeConversionWebSocket.md)의 독립 QA 단위 완료. 새 integration test와 계획/이 로그만 인계하며 production, registry, 부모 browser/full-QA 파일과 Git staging/commit은 변경하지 않았다.

## 결과

`apps/server/test/native-conversion-websocket.integration.test.ts`: 실제 AppModule HTTP + 인증된 owner/editor의 실제 WebSocket 두 연결을 사용하는 네 integration case 모두 PASS. 최종 실행은 19:29:30 KST 시작, Vitest 5.17초, 4 passed / 0 failed. socket frame은 ws message 이벤트에서 수집하고 publish/gateway/socket/timer mock이나 spy는 사용하지 않는다.

| 설계 | 변환 | 결과 |
| --- | --- | --- |
| 물리 테이블 없는 native 설계 | PostgreSQL → MySQL | PASS |
| 물리 테이블 없는 native 설계 | MySQL → PostgreSQL | PASS |
| signed16/32/64 세 컬럼 | PostgreSQL → MySQL | PASS |
| signed16/32/64 세 컬럼 | MySQL → PostgreSQL | PASS |

빈 물리 설계에도 원문 보존·후속 쓰기 확인용 domain이 있다. signed fixture는 실제 HTTP native commands로 생성한다. 원문/ID/logical metadata/comment/custom properties는 변환 계획 및 저장 row와 비교하며 세 signed 타입의 target ID를 따로 단언한다. MySQL source는 conversion registry가 검증한 기본 InnoDB 옵션만 선언한다. factory의 explicit charset override를 이 fixture에 넣지 않는다. flag/evidence override는 없다.

## 실제 관찰한 계약

- 두 actor가 token으로 실제 upgrade/authentication하고 subscribe ACK의 기존 sequence/revision을 확인한 뒤 HTTP preview/change를 호출한다. 두 socket 모두 `{type:'head', projectId, sequence, databaseRevision}`를 수신한다. 변환 후 version/sequence/revision은 각각 정확히 1 증가한다.
- head에는 kind/profile/document가 없다. 두 actor의 HTTP document-state와 이후 fresh native baseline으로 target kind/profile/revision, 원문, version/sequence를 확인한다. 기존 두 baseline은 DB에서 제거된다. conversion 자체는 native operation frame이 아니며 양쪽 events 조회는 gap에 대한 `resetRequired:true`와 현재 document/context를 반환한다.
- audit의 source 원문/version/sequence, changedPaths, from/to revision 및 operation ID를 확인한다. 프로젝트 생성 audit와 conversion audit는 action으로 구분한다. 전체 audit와 conversion ledger/native operation ledger/프로젝트 row를 replay 전후 비교한다.
- 이전 triple의 commands는 HTTP 409 `database.context-changed`로 거부되고 durable state가 변하지 않는다. 이전 baseline의 native operation은 현재 revision을 가진 rejected ACK와 빈 changes를 두 socket으로 전달한다. rejected sequence는 정확히 1 증가하고 원문/project version은 유지된다.
- owner/editor가 새 baseline으로 각각 쓰면 accepted ACK와 실제 operation frame을 두 socket이 받는다. frame의 ACK/changes는 실제 HTTP 응답/요청과 일치한다. version과 sequence는 매 쓰기마다 정확히 1 증가하며 revision은 유지된다. ACK에는 projectVersion 필드가 없으므로 version은 baseline 및 실제 저장 row로 검증한다.
- 동일 conversion 요청은 직후와 두 후속 쓰기 이후 모두 원래 결과를 replay한다. 두 accepted 요청도 원래 ACK를 replay한다. ledger/audit/counter/원문은 중복 변경되지 않는다. replay 뒤 각 socket의 subscribe ACK를 barrier로 두고 그때까지 추가 operation frame이 없음을 확인한다. 무한 시간의 frame 부재나 periodic head 부재를 주장하지 않는다.

## 격리·검증·재실행

normal `scripts/test-isolated.ts`가 localhost PostgreSQL에 새 `ezerd_qa_<UUID32>` DB를 생성하고 migration 및 테스트 뒤 finally DROP을 실행한다. 테스트 자체도 localhost와 정확한 UUID namespace를 검사한다. AppModule은 loopback 임의 포트를 사용한다. 사용자는 HTTP로 생성하며 editor membership만 해당 UUID workspace에 fixture INSERT한다. 소켓/app/pool 및 생성된 workspace/user가 정리되고 outer runner는 DB와 자신의 임시 MCP 로그 디렉터리를 제거한다. 최종 runner exit 0으로 cleanup까지 완료했다. 기존 사용자 DB, 등록된 QA resource, 다른 앱 포트/컨테이너는 사용하지 않았다.

실행 전 shared/server build 성공. 새 테스트에 strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes를 적용한 독립 noEmit typecheck PASS, root Prettier check PASS, git diff whitespace check PASS. typecheck는 임시 `.data` 설정이 server tsconfig를 extend하고 rootDir `..`, noEmit `true`, include를 이 파일 하나로 제한했으며 설정은 정리했다.

```powershell
pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-conversion-websocket.integration.test.ts
pnpm exec prettier --check apps/server/test/native-conversion-websocket.integration.test.ts
```

일반 Vitest에서 DB gate가 꺼진 실행은 actual evidence가 아니다. Singer의 전체 actual 재실행에는 위 새 파일 경로를 명시적으로 포함해야 한다. 기본 isolated runner의 기존 세 파일 목록은 이 단위에서 수정하지 않았다.

검증 범위는 PostgreSQL↔MySQL의 위 네 설계이며 SQLite 변환, 브라우저 reconnect/렌더링, 네트워크 분할의 모든 순서, role downgrade는 포함하지 않는다. 이 단위에서 product defect 또는 blocker는 발견하지 않았다. 부모 독립 커밋 및 전체 actual QA에 ready.
