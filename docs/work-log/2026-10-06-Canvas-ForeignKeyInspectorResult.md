# R04 FK 끝점·물리 정의 인스펙터 후속 연결

계획: [frontend 연결 계획](../planning/2026-10-06-Canvas-ForeignKeyInspectorPlan.md), [부모 Native 저장 확장 계획](../planning/2026-10-06-Canvas-ForeignKeyEndpointPlan.md). 선행 기록: [인스펙터 감사 복원](2026-10-06-Canvas-InspectorAuditCompletion.md)의 R04 계약 제한.

## 변경

- 부모가 확장한 sourceTableId/targetTableId와 physical:null 계약을 frontend의 기존 constraint draft/patch/form에 연결했다. contracts/server/model 및 NativeERDCanvas는 수정하지 않았다.
- physical:none→present 또는 현재 physical:null의 추가/복원은 name/sourceColumnIds/targetColumnIds/onDelete/onUpdate를 모두 보낸다. 미편집 NO ACTION 기본값도 포함한다. 기존 physical 정의를 편집할 때는 기존처럼 변경 필드만 보내므로 미편집 값·타입·default/generation·옵션·논리 endpoint를 재작성하지 않는다.
- 순수 logical scope의 관계에 실제 물리 FK를 추가하는 경우 scope를 both로 명시하여 논리 의미를 유지하며 물리 검사/표시를 활성화한다.
- 물리 제거는 반드시 physical:null이다. field 삭제/undefined, relation delete/recreate, v1 투영을 사용하지 않는다. 제거 중 숨겨진 physical 입력의 변경은 새 정의로 만들지 않는다. 별도 deferrable 제거를 명시한 경우 null을 보내고, 미편집 deferrable은 보존한다.
- 새 물리 정의의 deferrability 검사는 예전 null 객체가 아니라 새 끝점·scope·전체 physical을 가진 candidate를 사용한다.
- name을 포함한 physical 추가/변경/제거는 foreignKey capability가 usable이어야 한다. 물리 table/column 소속, nonempty·동일 쌍 수·중복을 frontend에서 검증한다. PK/UNIQUE 참조·타입·DB 옵션 호환성의 최종 권한은 부모의 locked server 검증이다.
- FK 정의 추가 버튼을 연결했다. 제거 후 다시 켤 수 있고 coupled mapping/이름/action 입력을 기존 Native form으로 편집한다.
- 실제 끝점 변경은 양쪽 mapping list/count/review를 초기화한다. 새 physical 추가 또는 끝점 변경은 exact 원본 관계·끝점·순서 있는 쌍에 대응하는 확인 token을 요구한다. pair 추가/삭제/수정과 mode 전환도 확인을 지운다. 같은 끝점의 재선택은 기존 mapping/review를 유지한다. 저장 기준이 변경되면 기존 stale/actor/databaseRevision/ACK guard를 계속 따른다.
- 같은 constraint draft key를 유지한다. 이전 archive에 새 mode/review 필드가 없더라도 기존 physical의 metadata partial patch가 완전 replacement로 바뀌지 않는다.

## 검증

- 전용 Native FK inspector 시험은 세 DB의 완전한 추가 payload/명시적 제거, 제거 후 full restore, logical→both, 미편집 필드·기존 옵션 보존, 오래된 draft 호환, endpoint reset·review invalidation, 잘못된 mapping/capability 거부, 새 physical deferrability candidate와 실제 추가 진입 UI를 검사한다.
- 부모의 변경된 contracts 산출물을 사용하기 위해 pnpm build:shared를 실행했다. 전체 build/check 또는 DB 작업은 하지 않았다.
- 최종 focused 회귀는 **29개 파일 / 356개 테스트 통과**이며 FK 전용 시험 17개가 포함된다. web typecheck, 담당 파일 Prettier check와 git diff --check도 통과했다. 브라우저는 사용자의 결정에 따라 제외했다.
- 부모는 backend 단위 207016e와 세 DB actual HTTP 검증 성공을 보고했다: 잘못된 endpoint/mapping은 rejected ACK로 기록되고 문서/version은 유지되며 sequence만 증가한다. 올바른 endpoint+mapping, physical:null 제거 시 logical/id 보존, 완전한 physical 복원이 적용됐다. 이 frontend 단위는 해당 HTTP 시험을 직접 실행하지 않았다.

R04의 frontend 계약 연결은 구현했다. 부모가 전체 통합 check를 담당하며 이 커밋은 contracts/server/model 및 부모 Canvas/App 변경을 포함하지 않는다.
