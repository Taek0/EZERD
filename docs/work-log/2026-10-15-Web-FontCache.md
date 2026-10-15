# 폰트 장기 캐시

- 기존 폰트 파일은 유지하고 CSS의 각 URL에 실제 파일 SHA-256을 `?v=...`로 추가했다. 같은 폰트는 재배포에도 같은 URL을 사용한다.
- 가져오기 스크립트도 동일한 URL을 생성한다. WOFF를 WOFF2로 이름만 바꾸지 않고 기존 실제 형식·unicode-range·swap을 유지한다.
- Nest 정적 파일 응답에서 manifest의 해시와 요청 버전이 일치하는 폰트만 `public, max-age=31536000, immutable`을 반환한다.
- HTML과 고정 경로 fonts.css, 버전 없는/다른 버전 폰트는 `no-cache`로 재검증한다. API 응답 캐시는 변경하지 않는다. manifest가 없는 이전 빌드는 보수적 캐시로 동작한다.
- 폰트 CSS의 모든 참조와 파일 바이트 해시, 캐시 헤더 정책 테스트 3개 통과. 서버 타입 검사 통과. 실제 브라우저 재방문 네트워크 측정은 수행하지 않았다.

계획: [폰트 캐시 및 갤러리 모션](../planning/2026-10-15-Web-FontCacheAndGalleryMotion.md)
