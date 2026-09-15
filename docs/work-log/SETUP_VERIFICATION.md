# 개발 환경 검증 기록

2026-09-14, Windows 로컬 환경에서 확인.

## 확인한 항목

- TypeScript strict 검사와 공통 패키지·NestJS·Vite 빌드 통과.
- 논리·물리 보기와 부모 적용 범위의 모델 규칙 테스트 3개 통과.
- API 직접 호출 및 Vite 프록시를 통한 실행 확인 200 응답.
- PostgreSQL 준비 전에는 준비 확인 API가 503 응답.
- PostgreSQL 18.6 컨테이너가 healthy 상태로 실행됨.
- 초기 Drizzle 마이그레이션 적용 성공.
- Drizzle INSERT·SELECT·기본값·트랜잭션 롤백 검증 성공.
- 브라우저에서 '다시 확인' 버튼을 눌러 API·DB가 모두 '연결됨'으로 갱신되는 것 확인.
- 해당 화면에서 브라우저 오류·경고 로그가 없음을 확인.
- 고정 lockfile 기반 오프라인 재설치 성공, Drizzle 스키마와 초기 마이그레이션 간 차이 없음.

이 기록은 개발 환경 검증이다. 제품 기능, 인증, 다중 사용자 협업이나 운영 배포 검증이 아니다.

## Docker Desktop 복구

Docker Desktop 4.83.0에서 시작 중 기존 통신 소켓에 대한 Windows 오류 1920이 발생했다. `dockerInference`를 정리한 뒤 `docker-secrets-engine/engine.sock`에서 같은 오류가 이어졌다.

사용자 승인 후 Docker Desktop을 종료하고 아래 런타임 폴더를 삭제하지 않고 백업 이름으로 변경한 뒤 재시작했다.

- `C:/Users/nty43/AppData/Local/Docker/run.ezerd-backup-20260914-113424`
- `C:/Users/nty43/AppData/Local/Docker/run.ezerd-backup-20260914-113604`
- `C:/Users/nty43/AppData/Local/docker-secrets-engine.ezerd-backup-20260914-113604`

이후 Docker 엔진 29.6.2가 정상 응답했다. 기존 이미지·컨테이너·볼륨의 초기화와 Docker 설정 변경은 수행하지 않았다. 재부팅 후 재발 여부까지 검증한 것은 아니다.

같은 증상에 대한 [Docker 공식 저장소의 사용자 보고](https://github.com/docker/desktop-feedback/issues/531)를 참고했다. 이 보고만으로 Windows 파일 시스템 전체의 손상이나 Docker 수정 완료 여부를 단정하지 않는다.

## 패키지 설치

첫 설치에서 pnpm 11이 이전 형식의 `.npmrc` 설정을 무시해 기본 캐시 `D:/.pnpm-store/v11`을 사용했다. 설정을 `pnpm-workspace.yaml`로 옮긴 뒤 프로젝트 내부 `.cache/pnpm-store`에서 재설치했다. 프로젝트 밖의 기존 공용 캐시는 삭제하지 않았다.

Drizzle Kit의 전이 의존성에서 `@esbuild-kit/core-utils`와 `@esbuild-kit/esm-loader` 사용 중단 경고가 있었다. 설치·마이그레이션 실행은 통과했으며, 향후 Drizzle Kit 업데이트 시 확인한다.

Vite 빌드는 통과했지만 현재 단일 JS 청크가 기본 500 kB 경고 기준을 넘었다(약 515 kB, gzip 약 155 kB). 캔버스와 화면 경로를 추가할 때 기능별 지연 로딩과 의존성 크기를 함께 검토한다.
