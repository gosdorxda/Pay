#!/usr/bin/env bash
#
# deploy.sh — update + deploy Pay Lottery di VPS (PM2 atau systemd).
#
# Menggantikan rantai perintah manual di DEPLOY-VPS.md §11:
#   stop → git pull → npm ci → prisma generate → tsc → build → start → verify
#
# Pakai:
#   ./deploy.sh                 # deploy normal
#   ./deploy.sh --no-pull       # lewati git pull (mis. sudah di-rsync manual)
#   ./deploy.sh --skip-install  # lewati npm ci (dependensi tidak berubah)
#   ./deploy.sh --dry-run       # hanya print langkahnya, tidak menjalankan
#
# Yang dijaga skrip ini:
#   • Service DIHENTIKAN sebelum build — kalau tidak, `next build` menimpa .next
#     yang sedang dipakai dan cache rusak ("Manifest file is empty").
#   • `.next` lama disalin ke `.next.prev` sebelum build; kalau build GAGAL,
#     .next lama dipulihkan (rollback otomatis).
#   • `tsc --noEmit` dijalankan sebelum build; error = berhenti tanpa menyentuh
#     .next sama sekali.
#   • Service selalu dinyalakan lagi lewat `trap` — bahkan kalau skrip dibatalkan.
#
# Rahasia tetap di `.env` (tidak dibaca/ditulis skrip ini).

set -Eeuo pipefail

# ── Konfigurasi (dari env atau default) ───────────────────────────────────────
APP_DIR="${APP_DIR:-/var/www/pay}"
SERVICE_NAME="${SERVICE_NAME:-pay}"
PM2_APP_NAME="${PM2_APP_NAME:-pay}"
APP_USER="${APP_USER:-pay}"

DO_PULL=1
DO_INSTALL=1
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --skip-install) DO_INSTALL=0 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

# ── Output ────────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
  C_RESET=""; C_BOLD=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi

step()  { echo; echo "${C_BOLD}${C_BLUE}==> $*${C_RESET}"; }
info()  { echo "    $*"; }
ok()    { echo "    ${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo "    ${C_YELLOW}!${C_RESET} $*"; }
fail()  { echo "${C_RED}✗ $*${C_RESET}" >&2; }

run() {
  if [ "$DRY_RUN" = "1" ]; then
    echo "    ${C_YELLOW}[dry-run]${C_RESET} $*"
    return 0
  fi
  "$@"
}

# ── Deteksi supervisor: systemd atau PM2 ──────────────────────────────────────
SUPERVISOR=""
if systemctl list-unit-files --type=service 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
  SUPERVISOR="systemd"
elif command -v pm2 >/dev/null 2>&1; then
  SUPERVISOR="pm2"
fi

if [ -z "$SUPERVISOR" ]; then
  fail "Tidak menemukan service systemd '${SERVICE_NAME}' maupun PM2."
  info "Set SERVICE_NAME=… atau PM2_APP_NAME=… lalu jalankan lagi."
  exit 1
fi

svc_stop() {
  case "$SUPERVISOR" in
    systemd) run sudo systemctl stop "$SERVICE_NAME" ;;
    pm2)     run sudo -u "$APP_USER" pm2 stop "$PM2_APP_NAME" ;;
  esac
}

svc_start() {
  case "$SUPERVISOR" in
    systemd) run sudo systemctl start "$SERVICE_NAME" ;;
    pm2)     run sudo -u "$APP_USER" pm2 restart "$APP_DIR/ecosystem.config.js" --update-env ;;
  esac
}

svc_status() {
  case "$SUPERVISOR" in
    systemd) sudo systemctl status "$SERVICE_NAME" --no-pager -n 12 || true ;;
    pm2)     sudo -u "$APP_USER" pm2 list || true ;;
  esac
}

# ── Trap: apapun yang terjadi, service harus hidup lagi ───────────────────────
STARTED=0
on_exit() {
  local code=$?
  if [ "$STARTED" = "0" ]; then
    warn "Skrip berhenti (exit ${code}) — menyalakan service kembali."
    svc_start || warn "Gagal menyalakan service; cek manual."
  fi
  exit "$code"
}
trap on_exit EXIT

# ── Mulai ─────────────────────────────────────────────────────────────────────
step "Deploy ${SERVICE_NAME} (${SUPERVISOR}) di ${APP_DIR}"
info "Pull: ${DO_PULL} · Install: ${DO_INSTALL} · Dry-run: ${DRY_RUN}"

cd "$APP_DIR" 2>/dev/null || { fail "Folder ${APP_DIR} tidak ditemukan."; exit 1; }

if [ "$DRY_RUN" = "0" ] && [ ! -f ".env" ]; then
  fail ".env tidak ditemukan di ${APP_DIR}."
  info "next start membaca rahasia dari .env di folder ini; tanpa itu app tidak jalan."
  exit 1
fi

# ── 1. Hentikan service (WAJIB sebelum build) ─────────────────────────────────
step "1/7 Hentikan service"
svc_stop
ok "service berhenti — build boleh menulis .next"

# ── 2. Ambil kode terbaru ─────────────────────────────────────────────────────
if [ "$DO_PULL" = "1" ]; then
  step "2/7 git pull"
  run git pull --ff-only
  ok "$(git log -1 --pretty='%h %s' 2>/dev/null || echo 'revisi saat ini')"
else
  step "2/7 git pull — dilewati (--no-pull)"
fi

# ── 3. Dependensi ─────────────────────────────────────────────────────────────
if [ "$DO_INSTALL" = "1" ]; then
  step "3/7 npm ci --include=dev"
  # `--include=dev` penting: typescript/tailwind/prisma CLI dipakai saat build.
  run sudo -u "$APP_USER" npm ci --include=dev
  ok "dependensi terpasang"
else
  step "3/7 npm ci — dilewati (--skip-install)"
fi

# ── 4. Prisma client ──────────────────────────────────────────────────────────
step "4/7 prisma generate"
run sudo -u "$APP_USER" npx prisma generate
ok "client dibuat ulang"

# ── 5. Type-check (gerbang: gagal = .next tidak disentuh) ─────────────────────
step "5/7 tsc --noEmit"
if [ "$DRY_RUN" = "1" ]; then
  echo "    ${C_YELLOW}[dry-run]${C_RESET} npx tsc --noEmit"
else
  if ! sudo -u "$APP_USER" npx tsc --noEmit; then
    fail "Type-check gagal — build dibatalkan, .next TIDAK disentuh."
    exit 1
  fi
  ok "0 error"
fi

# ── 6. Build (dengan rollback otomatis) ───────────────────────────────────────
step "6/7 npm run build"
if [ "$DRY_RUN" = "0" ]; then
  rm -rf .next.prev
  if [ -d .next ]; then
    cp -a .next .next.prev
    info "Build sebelumnya disalin ke .next.prev (rollback otomatis)"
  fi
fi

BUILD_OK=1
if [ "$DRY_RUN" = "1" ]; then
  echo "    ${C_YELLOW}[dry-run]${C_RESET} npm run build"
else
  # VPS 2 GB bisa OOM saat swap; heap 2 GB mengikuti DEPLOY-VPS.md §7.
  if ! sudo -u "$APP_USER" env NODE_OPTIONS=--max-old-space-size=2048 npm run build; then
    BUILD_OK=0
  fi
fi

if [ "$BUILD_OK" = "0" ]; then
  fail "Build GAGAL."
  if [ "$DRY_RUN" = "0" ] && [ -d .next.prev ]; then
    rm -rf .next
    mv .next.prev .next
    ok ".next sebelumnya dipulihkan"
  fi
  exit 1
fi

# ── 7. Nyalakan & verifikasi ──────────────────────────────────────────────────
step "7/7 Nyalakan service"
svc_start
STARTED=1
ok "service diminta start"

if [ "$DRY_RUN" = "0" ]; then
  info "Menunggu http://127.0.0.1:3000/ jawab (maks 30 s)…"
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 2 http://127.0.0.1:3000/ 2>/dev/null; then
      ok "HTTP 200 setelah ${i}s"
      break
    fi
    if [ "$i" = "30" ]; then
      warn "Belum menjawab setelah 30 s — cek log."
    fi
    sleep 1
  done
fi

echo
ok ".next.prev masih ada (hapus bila tak perlu: rm -rf .next.prev)"
echo "${C_BOLD}${C_GREEN}Deploy selesai.${C_RESET}"
svc_status
