#!/usr/bin/env bash
# One-time host preparation for the yagoda VPS. Idempotent: safe to re-run.
#   scp scripts/vps/bootstrap.sh root@188.245.146.122:/root/ && ssh root@188.245.146.122 bash /root/bootstrap.sh
# Does NOT install Coolify (its installer is run separately, see
# docs/coolify-deploy.md) and does NOT touch the firewall — Docker's published
# ports bypass UFW, so the firewall lives at Hetzner's edge, not on the host.
set -euo pipefail

SWAP_FILE=/swapfile
SWAP_SIZE_MB=2048

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

echo "== packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git jq >/dev/null

echo "== swap (${SWAP_SIZE_MB} MB at ${SWAP_FILE})"
if ! swapon --show=NAME --noheadings | grep -qx "$SWAP_FILE"; then
  if [ ! -f "$SWAP_FILE" ]; then
    fallocate -l "${SWAP_SIZE_MB}M" "$SWAP_FILE"
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE" >/dev/null
  fi
  swapon "$SWAP_FILE"
fi
grep -q "^${SWAP_FILE} " /etc/fstab || echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab

echo "== sysctl"
# Swap is a safety net, not a working mode: only page out under real pressure.
cat > /etc/sysctl.d/90-yagoda.conf <<'EOF'
vm.swappiness = 10
EOF
sysctl -q --system >/dev/null 2>&1 || echo "warning: sysctl --system failed (read-only /proc/sys? applies on next boot)"

echo "== backup directory"
install -d -m 750 /data/backups

echo "== done"
free -h
swapon --show
