# 핀·답글 등록 400 오류 수정

작성일: 2026-09-15

원인: 인증 세션을 통해 작성자를 결정하는 서버 createThreadSchema/createMessageSchema는 authorId를 금지한다. CommentsPanel이 이전 방식으로 authorId를 전송해 strictObject 검증에서 400이 발생했다. 첨부 요청의 소수 좌표와 null objectId는 정상 입력이다.

수정: 핀과 답글 전송에서 authorId를 제거하고 공유 계약으로 요청을 구성하는 pinRequest/replyRequest를 사용한다. 작성자는 서버가 기존대로 인증 세션에서 결정한다. DB 변경은 없다.

검증: 새 요청 테스트를 먼저 작성한 후 구현했고, 핀 요청·핀 좌표·서버 계약·쓰기 인증 관련 14개 테스트 통과. 웹 타입 검사 및 프로덕션 빌드 통과. 수정 파일에 Prettier 적용. 실제 배포 API에 핀을 생성하는 통합 검증은 수행하지 않았다.
