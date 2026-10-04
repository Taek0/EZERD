# Native 개인 상태 DB 문맥 보호 결과

- [계획](../planning/2026-10-02-Database-NativePersonalRevisionGuard.md). native 개인 snapshot에 databaseRevision을 반환하고 REST/MCP 신규 쓰기에 DB revision/shared version/sequence를 함께 요구한다. project row lock 아래 개인 version CAS와 문맥을 확인한다. v1 입력은 기존 expectedVersion/state를 유지한다.
- MCP는 read 권한에서 기존 operation ACK를 먼저 재생하고 locked replay 이후 새 personal 권한·활성·문맥을 검증한다. archived project에서도 같은 ACK를 재생하며 새 operation은 거부한다. native viewer의 개인 상태와 owner의 공유 원문은 분리된다.
- 최신 shared/server build 뒤 실제 isolated versioned/native-create/MCP3파일61개 통과. native3DB에서 누락·부분·각 문맥 좌표 불일치를409로 거부하고 동일 개인 CAS 경쟁200/409, 원문/개인 state 불변을 확인했다. native 일반 개인 저장/실제 MCP/기존 read/write·replay도 통과했다.
- workspace 전용 runner로 기존 API/autosync/MCP/workspace5파일40개 통과. 해당 suite가 요구하는 QA DB prefix를 일반 runner로 실행한 첫 시도는 거부되어 전용 실행기로 수정했다. runtime/tools 타입 검사 및 auth/private helper25개 통과. 전체 check/웹 실제 개인 저장 검증은 다음 단위다.

- 후속 unit의 personal access mock fixture도 native context를 명시하여 원본과 callback candidate의 분리 검사를 실제 경로까지 수행한다. nonmember는 read 단계에서 막고 archived member는 기존 ACK를 읽은 후 fresh 쓰기만 거부하는 기대를 반영했다. 관련9파일258개 재검증 중 personal access도 전부 통과했다. 제품 코드 변경 없이 테스트 기준을 `a99259c`에 맞춘 독립 교정이다.
