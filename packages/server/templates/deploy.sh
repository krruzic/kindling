#!/usr/bin/env bash
# Deploy a Kindling game image to a host over ssh (template): build locally, stream the image (no registry), compose
# up, health check.
#   IMAGE=mygame:latest HOST=me@server REMOTE_DIR=/srv/mygame URL=https://mygame.example ./deploy.sh
# Optional: DOCKERFILE (Dockerfile), CONTEXT (.), COMPOSE_FILE (docker-compose.yml), COMPOSE ("docker compose"; use
# "docker-compose" on older hosts), HEALTH_PATH (/healthz), HOST_PORT, DRY_RUN=1 (print the commands only).
set -euo pipefail

: "${IMAGE:?set IMAGE (e.g. mygame:latest)}"
: "${HOST:?set HOST (ssh target, e.g. me@server)}"
: "${REMOTE_DIR:?set REMOTE_DIR (directory on the host)}"
: "${URL:?set URL (public base URL for the health check)}"
DOCKERFILE="${DOCKERFILE:-Dockerfile}"
CONTEXT="${CONTEXT:-.}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE="${COMPOSE:-docker compose}"
HEALTH_PATH="${HEALTH_PATH:-/healthz}"

q() { printf '%q' "$1"; }
run() {
  echo "+ $*"
  [ -n "${DRY_RUN:-}" ] || bash -c "$*"
}

echo "==> build $IMAGE"
run "docker build -f $(q "$DOCKERFILE") -t $(q "$IMAGE") $(q "$CONTEXT")"

echo "==> ship to $HOST"
run "docker save $(q "$IMAGE") | gzip | ssh $(q "$HOST") 'gunzip | docker load'"
run "ssh $(q "$HOST") $(q "mkdir -p $(q "$REMOTE_DIR")")"
run "scp $(q "$COMPOSE_FILE") $(q "$HOST:$REMOTE_DIR/docker-compose.yml")"
ENV_LINES="IMAGE=$IMAGE"
[ -n "${HOST_PORT:-}" ] && ENV_LINES="$ENV_LINES
HOST_PORT=$HOST_PORT"
run "printf '%s\n' $(q "$ENV_LINES") | ssh $(q "$HOST") $(q "cat > $(q "$REMOTE_DIR/.env")")"

echo "==> up"
run "ssh $(q "$HOST") $(q "cd $(q "$REMOTE_DIR") && $COMPOSE up -d --remove-orphans")"

echo "==> health $URL$HEALTH_PATH"
run "curl -fsS --retry 15 --retry-delay 2 --retry-connrefused --max-time 5 $(q "$URL$HEALTH_PATH")"
echo
echo "deployed $IMAGE to $HOST ($URL)"
