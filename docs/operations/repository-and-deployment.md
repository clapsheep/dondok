# 저장소와 Mac mini 배포 원칙

## 목적

돈독은 public GitHub 저장소에서 프론트엔드와 백엔드를 분리해 관리하고, 개인 Mac mini에서 공개 도메인+HTTPS를 제공하는 Docker Compose 서비스로 운영한다. 2026-07-11에 애플리케이션 scaffold와 인증 첫 수직 기능을 시작했으며 아래 구조를 실행 기준으로 사용한다.

## 저장소 구조

```text
/
├── backend/                 # Java · Spring Boot · JPA · Flyway
│   ├── src/
│   ├── Dockerfile
│   └── .dockerignore
├── frontend/                # React · Vite · TypeScript · TanStack Query
│   ├── src/
│   ├── public/
│   ├── Dockerfile
│   └── .dockerignore
├── e2e/                     # QC 소유 Playwright 테스트
├── database/                # 현재 DB 설계와 독립 SQL 검증 자료
├── design/                  # 로고와 공통 디자인 토큰 원본
├── docs/
├── infra/                   # reverse proxy, 운영 스크립트와 백업 설정
├── compose.yaml             # 서비스 공통 정의
├── compose.dev.yaml         # 개발 환경 override
├── compose.prod.yaml        # Mac mini 운영 override
├── .env.example             # 이름과 안전한 예시만 추적
└── .gitignore
```

프론트엔드가 백엔드 소스에 의존하거나 그 반대가 되지 않게 한다. 두 애플리케이션의 유일한 결합점은 OpenAPI 계약, HTTP 프로토콜과 공유 문서다. Flyway migration의 실행 원본은 프로젝트 생성 시 `backend/src/main/resources/db/migration`으로 이동하며 같은 migration을 두 위치에서 복제 관리하지 않는다.

## 환경변수와 비밀정보

- 실제 값은 저장소 루트 `.env`, 앱별 `.env.local` 또는 Mac mini의 Docker secret 파일에만 둔다.
- `.env`, `.env.*`, 모든 하위 폴더의 환경파일과 `secrets/`는 Git에서 제외한다.
- 예외는 값이 비어 있거나 `CHANGE_ME`인 `.env.example`뿐이다.
- 환경변수가 추가·삭제되면 같은 PR에서 `.env.example`과 운영 문서를 갱신한다.
- 백엔드는 필수 환경변수가 없으면 애매한 기본값으로 실행하지 않고 시작 단계에서 변수 이름과 함께 종료한다.
- `VITE_*`는 브라우저 번들에 공개된다. API URL 같은 공개 설정만 허용하고 비밀번호, 세션 키, OAuth secret을 절대 넣지 않는다.
- `.env`는 Mac mini에서 소유자만 읽을 수 있게 `chmod 600`을 사용한다.
- 비밀값을 Dockerfile `ARG`, 이미지 `ENV`, 이미지 layer, 로그, GitHub Actions 출력에 넣지 않는다. private registry token이 필요하면 BuildKit secret을 사용한다.
- 개발·테스트·운영은 서로 다른 DB 비밀번호와 세션 키를 사용한다.

커밋 전에는 `git diff --cached`와 추적 파일 secret scan을 실행한다. secret이 한 번이라도 커밋되면 파일 삭제만으로 끝내지 않고 값을 즉시 폐기·재발급한 뒤 필요하면 Git 이력을 정리한다.

저장소 공개 전 전체 Git history를 secret scan하고 GitHub secret scanning과 push protection, branch protection과 required checks를 활성화한다. 운영 도메인 소유 정보, 인증서 private key, 암호화 백업과 실제 사용자 데이터도 저장소·issue·PR·CI artifact에 넣지 않는다.

## Docker 이미지

백엔드와 프론트엔드는 각각 독립 Dockerfile과 build context를 가진다.

### Backend

- Gradle/JDK build stage와 최소 JRE runtime stage를 분리한다.
- runtime은 root가 아닌 전용 사용자로 실행한다.
- JAR와 필요한 인증서만 runtime image로 복사한다.
- Actuator readiness/liveness endpoint를 Docker healthcheck에 연결한다.
- JVM 메모리는 컨테이너 한도를 인식하도록 설정하고 timezone은 데이터 저장이 아닌 표시와 스케줄링에만 사용한다.

### Frontend

- Node build stage와 정적 파일 전용 non-root web server stage를 분리한다.
- API 주소는 가능하면 같은 origin의 `/api` 상대 경로를 사용해 운영 환경별 재빌드를 줄인다.
- source map 공개 여부를 운영 설정에서 명시하고, `.env`와 `node_modules`는 build context에서 제외한다.
- `/health`와 SPA route fallback을 함께 검증한다.

각 `.dockerignore`에는 최소한 `.git`, `.env*`, `secrets`, build output, IDE 파일을 포함한다. 단, build에 안전한 예시가 필요할 때만 `.env.example`을 명시적으로 허용한다.

base image는 프로젝트 생성 시 공식 지원 버전과 보안 패치를 확인해 고정한다. 운영 image에 `latest` 태그만 사용하지 않고 앱 버전과 Git SHA를 기록한다. Mac mini의 CPU가 Apple Silicon이면 `linux/arm64`를 기본으로 빌드하되 Dockerfile에 특정 architecture를 하드코딩하지 않는다.

## Compose 운영 경계

운영 구성은 다음 컨테이너를 기본으로 한다.

```text
reverse proxy / frontend
          │
          ├── /api ──────── backend
          │                    │
          │                  PostgreSQL
          └── 정적 frontend
```

- 외부에는 reverse proxy 포트만 공개한다.
- PostgreSQL과 backend는 내부 network에 두고 PostgreSQL 포트를 Mac 외부에 공개하지 않는다.
- 모든 장기 실행 컨테이너에 healthcheck와 `restart: unless-stopped`를 둔다.
- PostgreSQL 데이터는 named volume, 백업 결과는 권한이 제한된 host directory에 둔다.
- migration은 backend 시작 전에 한 번만 적용하고 여러 인스턴스가 동시에 migration하지 않게 한다.
- compose는 `${VARIABLE:?message}` 형식으로 필수 비밀값 누락을 조기에 거부한다.
- 개발용 bind mount와 debug port는 `compose.dev.yaml`에만 둔다.
- 운영 resource limit과 log rotation은 `compose.prod.yaml`에서 관리한다.

Redis는 단일 backend 인스턴스에서는 넣지 않는다. reverse proxy 제품은 구현 시 고르는 되돌릴 수 있는 세부사항이지만 다음 공개 운영 계약은 필수다.

- HTTP 80은 HTTPS 443으로 redirect하고 인증서를 자동 발급·갱신한다.
- session cookie는 `Secure`, `HttpOnly`, 적절한 `SameSite`를 사용하고 same-origin CSRF 방어를 검증한다.
- 가입·로그인·초대 확인/수락·비밀번호 재설정 endpoint에 rate limit을 둔다.
- trusted proxy와 forwarded header를 명시하고 backend health/debug endpoint를 공개하지 않는다.
- Mac mini 방화벽에서도 reverse proxy 포트만 허용하고 backend·PostgreSQL 포트는 외부에서 접근할 수 없어야 한다.

## GitHub Actions 배포 경계

[GitHub의 self-hosted runner 보안 지침](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)에 따라 public 애플리케이션 저장소에는 Mac mini self-hosted runner를 등록하지 않는다. public fork와 PR이 수정한 workflow가 운영 호스트에서 실행될 수 있기 때문이다. 배포 전용 private 저장소 `clapsheep/dondok-deploy`에만 runner `clapsheep-server-dondok`을 등록하고 다음 순서를 실행한다.

1. GitHub-hosted runner가 public `dondok` 저장소의 현재 `main` SHA를 읽는다.
2. 같은 SHA의 `CI` push run이 성공했는지 확인하고, 다르면 배포하지 않는다.
3. private 저장소에만 연결된 Mac mini runner가 검증된 SHA를 checkout한다.
4. [`infra/deploy-production.sh`](../../infra/deploy-production.sh)가 SHA tag로 backend·frontend image를 build한다.
5. 기존 DB가 실행 중이면 새 배포 전에 daily bundle과 격리 복원 drill을 성공시킨다.
6. 운영 전용 checkout을 해당 SHA로 전환하고 `docker compose up --no-build --wait`로 교체한다.
7. 실패하면 migration 이전 backup을 남긴 채 직전 SHA image와 checkout으로 애플리케이션 rollback을 시도한다.
8. GitHub-hosted runner가 공개 URL의 HTTPS, HSTS, HTTP redirect, `/healthz`, CSRF endpoint를 외부에서 확인한다.

private 배포 저장소 workflow만 GitHub environment의 다음 비민감 변수를 사용한다. 실제 비밀번호나 SMTP credential은 GitHub에 복제하지 않는다.

| 변수 | Mac mini 값 |
| --- | --- |
| `DONDOK_DEPLOY_DIR` | `/Users/clapsheep-server/services/dondok` |
| `DONDOK_ENV_FILE` | `/Users/clapsheep-server/.config/dondok/production.env` |
| `DONDOK_BACKUP_DIR` | `/Users/clapsheep-server/Backups/dondok-postgres` |
| `DONDOK_STATE_DIR` | `/Users/clapsheep-server/.local/state/dondok` |
| `DONDOK_PUBLIC_URL` | 실제 `https://` origin |

운영 환경파일과 상태·백업 디렉터리는 각각 0600·0700이어야 한다. 배포 lock은 동시에 두 release가 Compose와 DB에 접근하는 것을 막는다. production 로그와 DB dump는 public Actions log·artifact로 올리지 않고 Mac mini의 제한된 경로에서만 조사한다. Docker Desktop과 runner는 사용자 LaunchAgent이므로 재부팅 뒤 해당 macOS 사용자의 GUI session이 시작되어야 한다.

## 데이터와 복구

이미지는 언제든 다시 만들 수 있어야 하고 영속 데이터는 PostgreSQL volume에만 둔다. 운영 전 다음을 자동화한다.

- 매일 1회 `pg_dump`를 만들고 30일 rotation 적용
- 주 1회 백업을 암호화해 Mac mini 밖의 별도 장치/위치에 복제
- 암호화 키는 백업 파일·GitHub·Mac mini의 동일 경로와 분리
- 빈 PostgreSQL에 최신 백업을 복원하는 실제 복구 테스트
- 표본 weekly off-device 백업의 복호화·무결성·복원 테스트
- migration 전 수동 또는 자동 백업 지점 생성

컨테이너 재시작 성공은 복구 검증이 아니다. 복원 테스트가 통과해야 백업이 유효한 것으로 본다.

운영 PostgreSQL에서 삭제한 가계부는 서비스에서 즉시 사라진다. 이미 생성된 암호화 백업에는 삭제 전 데이터가 rotation 전까지 최대 30일 남을 수 있으며 이후 자동 만료한다. 삭제 안내에는 이 최대 보존 기간을 명시하고, 복구 drill은 삭제된 가계부가 다시 서비스되지 않도록 삭제 이후 기록을 재적용하거나 삭제 이후 백업을 선택하는 절차까지 검증한다.

### 일일 PostgreSQL 백업

[`infra/postgres-backup.sh`](../../infra/postgres-backup.sh)는 host에서 실행하되 dump는 검증한 Compose `db` 컨테이너의 PostgreSQL 18 도구로 만든다. `custom + zstd`, `--no-owner`, `--no-acl`, 30초 lock 대기를 사용하며 운영 DB에는 dump와 manifest용 조회만 수행한다. 결과는 저장소 밖의 전용 0700 디렉터리에 0600 파일로 쓰고, archive list·크기·SHA-256·PostgreSQL image digest·Flyway version 확인이 끝난 bundle만 디렉터리 단위로 원자적 rename한다. 성공 뒤 UTC 생성 시각이 30×24시간 이상 지난 완성 bundle을 제거한다. symlink와 진행 중 partial은 자동 삭제하지 않는다.

운영 Mac에서 최초 한 번 전용 경로를 준비한다. 아래 경로는 예시이므로 실제 절대 경로로 바꾼다.

```bash
mkdir -p /absolute/private/path/dondok-postgres
chmod 700 /absolute/private/path/dondok-postgres
chmod 600 /absolute/repository/dondok/.env
```

수동 운영 백업은 운영 stack을 띄울 때 사용한 Compose 파일을 정확히 같은 순서로 명시한다.

```bash
cd /absolute/repository/dondok
./infra/postgres-backup.sh \
  --env-file "$PWD/.env" \
  --compose-file "$PWD/compose.yaml" \
  --compose-file "$PWD/compose.prod.yaml" \
  --backup-dir /absolute/private/path/dondok-postgres \
  --retention-days 30
```

다른 checkout이나 개발 stack을 조용히 백업하지 않도록 스크립트는 실행 중 컨테이너의 Compose working directory와 config file label을 명령의 값과 대조한다. `.env` 값은 source하거나 manifest·로그에 출력하지 않는다. `.maintenance.lock`이 남아 있으면 owner 파일의 PID·시각과 실행 프로세스를 사람이 확인한 뒤에만 제거한다.

### 격리 복구 drill

[`infra/postgres-restore-drill.sh`](../../infra/postgres-restore-drill.sh)는 live DB·Compose·`.env`를 사용하지 않는다. bundle의 dump와 manifest checksum, archive 크기, 현재 checkout Flyway version을 먼저 확인하고, manifest에 기록된 PostgreSQL repository digest가 로컬에 있을 때만 그 image를 사용한다. image가 없으면 자동으로 임의 tag를 당겨 쓰지 않고 기록된 digest를 먼저 `docker pull`하라고 실패한다.

복원 대상은 포트를 열지 않은 `--network none` 컨테이너와 고유한 throwaway volume이다. manifest의 원본 `pg_database_size` 3배와 고정 1GiB 여유를 Docker volume에서 확보하지 못하면 복원을 시작하지 않는다. 빈 DB 확인 뒤 `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`로 복원하고 Flyway history, 필수 relation·view·index, 검증 제약, 21개 ledger cascade FK와 대표 orphan 부재를 검사한다. 성공과 실패 모두 자기 run ID label이 일치하는 임시 자원만 제거하며, 정상 종료는 컨테이너·volume·lock이 실제로 사라졌을 때만 반환한다. 운영 DB와 같은 Docker Desktop VM에서 실행하는 수동 drill은 이 사전 검사에도 불구하고 부하가 낮을 때 수행하며, 실제 release·재해 훈련은 가능하면 별도 Docker host/context에서 실행한다.

```bash
cd /absolute/repository/dondok
LATEST_BUNDLE=/absolute/private/path/dondok-postgres/dondok-postgres-YYYYMMDDTHHMMSSZ
./infra/postgres-restore-drill.sh --backup "$LATEST_BUNDLE"
```

`--denylist /absolute/private/path/deleted-ledger-denylist`에는 한 줄에 하나의 삭제된 ledger UUID만 둘 수 있고 파일은 0600이어야 한다. 이 입력이 없으면 위 명령은 archive·schema·data 구조 drill만 성공시키고, 재해 복구 승격에 충분하지 않다는 경고를 남긴다. 임의 UUID로 denylist 코드 경로가 통과한 것은 실제 삭제 이력의 내구성을 증명하지 않는다.

실제 서비스 복구는 이 drill 결과를 그대로 운영에 연결하는 작업이 아니다. 삭제 이력 재적용 또는 삭제 이후 복구 지점 검증이 끝난 뒤, 복원된 `spring_session`, 이메일 인증·비밀번호 재설정 token과 미사용 초대를 무효화하고 backend migration·readiness를 별도 내부 network에서 검증한 후에만 트래픽을 전환한다.

### macOS launchd 예약

[`infra/launchd/com.dondok.postgres-backup.plist.example`](../../infra/launchd/com.dondok.postgres-backup.plist.example)은 매일 03:30에 운영 Compose 대상으로 백업을 실행하는 설치 전 template이다. 저장소에는 placeholder만 추적한다.

1. `__DONDOK_REPOSITORY__`, `__DONDOK_ENV_FILE__`, `__DONDOK_BACKUP_DIR__`, `__DONDOK_LOG_DIR__`를 공백을 포함해도 되는 실제 절대 경로로 치환한 사본을 `~/Library/LaunchAgents/com.dondok.postgres-backup.plist`에 둔다.
2. log directory를 미리 만들고 0700으로 제한한다. plist와 백업 스크립트가 현재 사용자 소유인지 확인한다.
3. `plutil -lint ~/Library/LaunchAgents/com.dondok.postgres-backup.plist`를 통과시킨다.
4. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dondok.postgres-backup.plist` 후 `launchctl kickstart -k gui/$(id -u)/com.dondok.postgres-backup`으로 한 번 즉시 실행한다.
5. 새 bundle, log, 0600/0700 mode를 확인하고 그 bundle로 격리 복구 drill을 통과시킨다.

template은 login shell이나 shell 문자열 평가 없이 executable과 각 인수를 직접 전달하고 launchd umask도 077로 둔다. 예약 등록 자체는 성공 보장이 아니므로 다음 날 bundle freshness와 error log를 확인해야 한다. off-device 복제·암호화·실패 알림은 관련 제품 결정 뒤 별도 단계로 연결한다.

개발 stack에서 전체 안전 경계를 다시 검사할 때는 실제 개발 DB에 dump/read만 수행하는 smoke를 사용한다. temp dump는 종료 시 제거되고 restore는 격리 자원만 사용한다.

```bash
cd /absolute/repository/dondok
./infra/tests/postgres-maintenance-smoke.sh \
  --env-file "$PWD/.env" \
  --compose-file "$PWD/compose.yaml" \
  --compose-file "$PWD/compose.dev.yaml"
```

## 로컬 실행

```bash
cp .env.example .env
# 로컬 값으로 .env를 수정한 뒤
docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait
```

- 웹: `http://localhost:5173`
- 백엔드 health: `http://localhost:8080/actuator/health/readiness`
- 개발 메일함: `http://localhost:8025`

운영은 저장소 밖의 0600 `production.env`에 실제 도메인·PostgreSQL·SMTP 값을 넣고 private 배포 저장소 workflow로 기동한다. 긴급 수동 배포도 임의 branch가 아니라 CI를 통과한 `main`의 전체 Git SHA를 [`infra/deploy-production.sh`](../../infra/deploy-production.sh)에 전달한다. 운영 구성은 Caddy만 80/443을 공개하며 backend와 PostgreSQL은 호스트 포트를 열지 않는다.

## 프로젝트 생성 완료 조건

- `backend/`, `frontend/`, `e2e/`가 독립 명령으로 build/test 가능
- 각 Dockerfile의 multi-stage, non-root, healthcheck 검증
- `.dockerignore`에서 모든 환경파일과 secret 제외
- `.env.example`과 실제 설정 변수 목록 일치
- `docker compose -f compose.yaml -f compose.dev.yaml config` 성공
- Mac mini와 같은 architecture로 production image build 성공
- 깨끗한 환경에서 Compose 기동, Flyway 적용, backend/frontend healthcheck 통과
- 컨테이너 재생성 후 PostgreSQL 데이터 유지 확인
- QC의 최소 Playwright smoke test 통과
- 공개 URL의 HTTPS redirect·인증서 갱신·cookie/CSRF/rate limit 검증과 backend/DB 포트 비노출 확인
