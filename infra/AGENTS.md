# 인프라 작업 규칙

- secret은 `.env` 또는 호스트 secret store로만 주입하며 이미지와 Git에 넣지 않는다.
- 운영 DB와 Docker socket을 MCP나 광범위한 자동화에 노출하지 않는다.
- Flyway 실행 원본은 백엔드 `src/main/resources/db/migration` 한 곳뿐이다.
- Mac mini 배포 변경은 `docker compose config`와 healthcheck를 먼저 검증한다.
