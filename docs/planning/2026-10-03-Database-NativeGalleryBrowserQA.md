# Native 갤러리 DB 변경 브라우저 QA 계획

- 기존 NativeBrowserPathQA 계획의 후속으로 실제 갤러리 C8 소비 수정 번들을 검증한다. 작업 소유 UUID DB/owner를 재사용하고 변경 전 원문·ID·카운터를 .data/native-gallery-browser-before.json에 보존한다.
- 빈 PG→SQLite 목표 DB/profile 변경, signed INTEGER PG→MySQL의 영향 객체·타입/옵션 검토와 명시 적용, 미지원 SQLite 변환 차단을 정상 UI로 확인한다. 이름 변경은 DB ACK 뒤 별도 검증된 metadata 저장으로 확인한다.
- Loopback3150 작업 소유 프록시는 동일3139 QA 서버로 정상 HTTP/WS를 전달하고 지정 QA 프로젝트의 성공 DB-change 응답 하나만 drain 뒤 연결을 종료한다. 서버 commit 뒤 응답 유실을 만들며 인증/권한/검증 정책을 우회하거나 토큰을 기록하지 않는다. 원문 요청 보존→동일 operation 재확인→중복 DB 변경 없음·정확한 ACK·최종 큐 해제를 확인한다.
- 실제 웹 조회와 QA DB 원문/ledger/counter 비교를 구분해 기록한다. helper·mock을 브라우저 성공으로 계산하지 않는다. 다운로드가 가능하면 실제 target DB SQL bytes를 보존하고 실행한다.
- JSON 브라우저 파일 업로드의 권한 거부를 우회·재시도하지 않는다. 다른 UI 검증만 진행한다.
- 종료 후3150 프록시/3139 QA listener 및 정확한 소유 DB·임시 파일을 정리한다. 사용자 개발 DB/다른 프로세스·Downloads 원본을 보존한다.