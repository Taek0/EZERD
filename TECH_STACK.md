# EZERD 세부 기술 스택 제안

작성일: 2026-09-14

## 확정과 제안

- 확정: TypeScript, Drizzle ORM, 브라우저 기반 제품, 사내 서버 배포, PostgreSQL을 대상으로 하는 ERD 설계.
- 목표: 팀원이 제품을 사용하다 수정이 필요할 때 기능별 코드와 변경 영향을 쉽게 파악한다.
- 개발 환경 구성 요청에 따라 아래 기반 구성을 적용했다. 제품 캔버스·실시간 협업 라이브러리는 후속 기능 단계에서 추가한다.

## 현재 적용된 개발 환경

- pnpm workspace에 웹, 서버, 공통 모델, API 계약 패키지를 구성했다.
- React·Vite, NestJS, Zod, Drizzle ORM·Kit, PostgreSQL 개발 컨테이너를 적용했다.
- 공통 TypeScript strict 설정, lockfile, 모델 테스트, API·DB 상태 화면, 초기 마이그레이션과 DB 검증 스크립트를 제공한다.
- Tailwind·shadcn/ui, React Flow, Yjs·Hocuspocus, Playwright는 아직 설치하지 않았다. 해당 기능을 구현하는 단계에서 추가한다.
- PostgreSQL DDL 생성 패키지는 후속 단계에서 만든다.
- 구체적인 버전과 실행 명령은 [README](./README.md), Drizzle 학습 예제는 [입문 문서](./docs/DRIZZLE_START.md)를 참고한다.

## 추천 구성

| 영역 | 제안 | EZERD에서의 역할 |
| --- | --- | --- |
| 언어 | TypeScript, strict 설정 | 화면·서버·공유 모델의 타입 검사 |
| 프런트엔드 | React + Vite | 프로젝트 갤러리, 편집 화면, 댓글 패널과 개발·빌드 환경 |
| 캔버스 | React Flow (@xyflow/react) | 도메인·테이블·텍스트 노드, 연결선, 이동·확대·선택 |
| UI | Tailwind CSS + shadcn/ui | 입력 폼, 메뉴, 팝오버, 다이얼로그 등 수정 가능한 UI 기반 |
| 서버 | Node.js LTS + NestJS | 인증, 프로젝트·권한, 댓글·멘션·알림, 내보내기 API |
| 공동 편집 | Yjs + Hocuspocus | 공유 문서의 변경 병합, WebSocket 연결, 문서 인증·저장 연동 |
| 앱 DB | PostgreSQL | 사용자·권한·댓글·알림, 협업 문서의 영속 상태 |
| DB 접근 | Drizzle ORM (채택) + Drizzle Kit (제안) | 앱 DB의 타입 있는 조회와 스키마 마이그레이션 |
| 입력 검증 | Zod | API 요청·응답, 파일 가져오기, 공통 데이터 검증 |
| 저장소 구성 | pnpm workspaces | 하나의 저장소에서 웹·서버·공통 패키지를 관리 |
| 검증 | Vitest + Playwright | 모델·DDL 규칙, 브라우저 조작과 다중 사용자 시나리오 |
| 배포 | Docker Compose + 사내 리버스 프록시 | 정적 웹 파일, API·협업 서버, PostgreSQL 실행 구성 |

정확한 버전은 초기 설치 시 호환성을 확인해 고정하고 lockfile과 실행 환경 버전을 저장소에 포함한다.

## 주요 선택 이유와 한계

### React + Vite

갤러리와 편집기를 React 컴포넌트로 구성하고, Vite로 로컬 개발 서버와 배포용 정적 파일을 만든다. 로그인 뒤 캔버스를 사용하는 사내 제품에 브라우저 렌더링 방식이 적합하다는 판단이다.

UI는 프로젝트, 캔버스, 도메인, 테이블 편집기, 댓글 등 사용자가 아는 기능별로 묶는다. Vite 개발 서버는 운영 배포 서버로 사용하지 않는다.

### React Flow

커스텀 React 노드를 통해 도메인 카드, 테이블과 컬럼, 자유 텍스트를 구성할 수 있다. 기본 드래그·선택·연결과 viewport 제어를 이용하고 제품 고유의 규칙을 별도로 구현한다.

- 도메인 클릭 시 viewport 이동·확대와 내부 ERD 전환을 조합한다. 자연스러운 전환 전체가 라이브러리만으로 자동 완성되지는 않는다.
- 테이블 본문과 컬럼별 연결 지점, 관계의 표기법은 EZERD 컴포넌트로 작성한다.
- 댓글 핀은 별도 노드 또는 캔버스 좌표에 연결한 오버레이로 구현할 수 있다.
- React Flow의 노드·연결선 형식을 설계 데이터의 저장 원본으로 삼지 않는다. 모델에서 화면 객체를 만드는 변환 계층을 둔다.
- 큰 ERD에서는 컬럼 수, 관계선, 동시 편집 빈도를 반영한 성능 검증이 필요하다.

### Tailwind CSS + shadcn/ui

shadcn/ui는 UI 소스 코드를 프로젝트에 가져와 수정하는 방식을 제공하므로, 팀이 테이블 속성 패널이나 댓글 입력 UI를 직접 바꾸기에 적합하다고 판단한다. 공통 색상·간격은 토큰으로 관리한다. 가져온 컴포넌트의 수정·업데이트도 팀이 관리해야 한다.

### NestJS

프로젝트, 멤버십, 댓글 등의 모듈 안에서 HTTP 요청 처리, 업무 규칙, 저장소 접근을 분리한다. 일관된 구조가 팀원의 코드 탐색에 도움이 된다는 판단이다. 모듈과 의존성 주입에 익숙해지는 초기 학습 비용은 있다.

초기 서버는 하나의 앱으로 구성한다. Hocuspocus는 NestJS 서버 수명주기에서 관리하거나 같은 배포 안의 별도 프로세스로 실행할 수 있으며 연결 방식은 초기 구성에서 결정한다. 협업 문서 접속과 API 요청 모두 동일한 프로젝트 권한 정책을 사용한다.

### Yjs + Hocuspocus

Yjs는 변경 병합을, Hocuspocus는 Yjs 문서의 WebSocket 연결과 인증·저장 연동을 담당한다. Hocuspocus 서버에는 대응하는 Hocuspocus provider를 사용한다.

- 초기 제안은 프로젝트별 하나의 설계 협업 문서다. 이는 프로젝트 내 동일 접근 권한을 전제로 하며, 권한 세분화·규모 확대 시 분할을 재검토한다.
- 도메인·테이블·컬럼은 ID별로 관리하고 속성 단위로 수정한다. 자유 텍스트는 공동 편집 텍스트로 다룬다.
- 캔버스 설계의 원본은 협업 문서다. PostgreSQL에는 복원 가능한 바이너리 상태와 필요한 변경분을 저장한다.
- 조회·검색용 JSON이나 테이블을 추가하면 원본에서 생성하는 데이터로 취급한다. 같은 설계를 SQL API와 협업 문서 양쪽에서 독립 수정하지 않는다.
- 권한·댓글·멘션·알림은 일반 API와 관계형 테이블로 관리하고 변경 사실을 구독자에게 전달한다.
- 커서·선택 상태는 일시적인 협업 상태다. 개인 확대율과 열린 패널은 개인 화면 상태다.
- 문서 병합이 참조 무결성과 업무 규칙을 보장하지는 않는다. 삭제·동일 속성 충돌, 연결 유효성, 서버 저장 확인과 복원 정책을 별도로 구현한다.

### PostgreSQL + Drizzle + Zod

PostgreSQL은 기존에 결정한 ERD 대상 DB이며, EZERD 자체 저장소로도 추천한다. 프로젝트·권한·댓글에는 관계형 구조, 확장 속성과 조회용 스냅샷에는 JSONB, 협업 복원 상태에는 바이너리 저장을 활용한다.

Drizzle은 앱 DB 스키마와 조회를 TypeScript로 작성하는 도구다. 사용자가 그린 ERD의 PostgreSQL DDL을 생성하는 기능은 별도의 EZERD 모델·생성기로 작성한다.

Zod는 TypeScript의 컴파일 시점 검사를 보완해 실제로 들어온 데이터를 실행 시점에 검사한다. 공유 스키마를 정의하고 TypeScript 타입을 도출하여 요청 타입과 검증 규칙의 중복을 줄인다.

## 실제 기능과 연결한 Drizzle 학습 순서

| 구현할 기능 | 함께 익힐 내용 |
| --- | --- |
| 프로젝트 데이터 구조 | 테이블·컬럼 정의, PK·기본값·NULL 제약, 타입 추론 |
| 프로젝트 생성과 갤러리 | INSERT·SELECT, 조건, 정렬, 페이지 조회 |
| 프로젝트 수정·보관 | UPDATE, 대상 조건과 영향 범위 확인 |
| 프로젝트 참여자와 댓글 | FK, JOIN, 필요한 컬럼 선택과 결과 타입 |
| 댓글 작성과 멘션 알림 기록 | 트랜잭션과 중복 방지 제약 |
| 새 필드 추가 | Drizzle Kit 기반 마이그레이션 생성, SQL 검토, 개발 DB 적용 |

- 첫 기능에서는 Drizzle 코드와 대응하는 SQL을 함께 설명한다.
- 설명은 기능 단위 개발 문서와 변경 설명에 두고, 코드 주석은 의도와 주의할 규칙 위주로 작성한다.
- 서버의 데이터 접근 함수에서 쿼리를 찾을 수 있도록 구성하고, 학습 초기부터 과도한 범용 래퍼를 추가하지 않는다.
- 실제 앱 기능을 순서대로 구현하며 익힌다. 학습용 예제만 동작하는 별도 앱을 만들지 않는다.

## 저장소 구조 제안

```text
apps/
  web/                  # React 화면, 기능별 컴포넌트, 캔버스 어댑터
  server/               # NestJS API, 권한, DB 접근, 협업 서버 연동
packages/
  model/                # 논리·물리 통합 모델, 검증, 편집 규칙
  contracts/            # API 요청·응답 스키마와 타입
  postgres-export/      # PostgreSQL 타입·제약 검증과 DDL 생성
```

공유 모델은 React, NestJS, Drizzle에 의존하지 않는다. 서버 DB 코드와 자격 증명은 브라우저에서 가져오는 공유 패키지에 넣지 않는다.

예를 들어 컬럼 특성을 추가할 때 모델·검증 규칙, 속성 패널, 필요 시 DDL 생성기를 수정한다. 도메인 카드 디자인을 바꾸는 경우에는 웹의 해당 컴포넌트만 수정할 수 있어야 한다.

화면 내부에서 끝나는 상태는 React 상태로 시작한다. 프로젝트 목록의 캐시나 복잡한 UI 상태가 필요해질 때 별도 도구를 추가하되, Yjs의 설계 원본을 다른 상태 저장소에서 중복 관리하지 않는다.

## 실행·운영 기준

- 로컬 개발 명령, 예제 환경 변수 파일, 개발용 데이터와 마이그레이션 절차를 문서화한다.
- 브라우저·API·협업 연결은 같은 사내 서비스 주소 아래에서 제공하는 안을 제안한다.
- 인증은 사용자 ID·프로젝트 멤버십 모델을 먼저 정의하고 사내 SSO 연결 여부는 확인 후 결정한다.
- DB 마이그레이션과 백업·복구를 배포 절차에 포함한다.
- 검증 대상은 논리·물리 독립 편집, DDL, 두 브라우저 동시 수정, 삭제 충돌, 재접속, 서버 재시작 후 복원, 댓글 위치와 멘션 권한이다.

## 참고한 공식 문서

- [Vite](https://vite.dev/guide/)
- [React Flow 커스텀 노드](https://reactflow.dev/learn/customization/custom-nodes)
- [React Flow viewport API](https://reactflow.dev/api-reference/types/react-flow-instance)
- [shadcn/ui](https://ui.shadcn.com/docs)
- [NestJS 모듈](https://docs.nestjs.com/modules)
- [Yjs 공유 자료구조](https://docs.yjs.dev/getting-started/working-with-shared-types)
- [Hocuspocus](https://tiptap.dev/docs/hocuspocus/getting-started/overview)
- [Hocuspocus 인증](https://tiptap.dev/docs/hocuspocus/guides/authentication)
- [Hocuspocus 저장](https://tiptap.dev/docs/hocuspocus/guides/persistence)
- [Hocuspocus provider](https://tiptap.dev/docs/hocuspocus/provider/overview)
- [Drizzle](https://orm.drizzle.team/docs/overview)
- [Zod](https://zod.dev/)
- [pnpm workspaces](https://pnpm.io/workspaces)
