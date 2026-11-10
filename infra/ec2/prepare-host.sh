#!/usr/bin/env bash
# Host prerequisites only. Does not clone/start the app or issue certificates.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

if [ "$(id -u)" -ne 0 ]; then
  echo 'Run with sudo.' >&2
  exit 1
fi
. /etc/os-release
if [ "$ID" != ubuntu ] || [ "$VERSION_ID" != 24.04 ] || [ "$(dpkg --print-architecture)" != amd64 ]; then
  echo 'Expected Ubuntu 24.04 amd64; no installation performed.' >&2
  exit 1
fi

echo 'Installing host utilities, Nginx and Certbot from Ubuntu repositories.'
apt-get -o DPkg::Lock::Timeout=180 update
apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends \
  ca-certificates curl git jq unzip nginx certbot python3-certbot-nginx

echo 'Configuring the official Docker repository.'
install -m 0755 -d /etc/apt/keyrings
if [ ! -f /etc/apt/keyrings/docker.asc ]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
fi
if [ ! -f /etc/apt/sources.list.d/docker.sources ]; then
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
EOF
elif ! grep -q '^URIs: https://download.docker.com/linux/ubuntu$' /etc/apt/sources.list.d/docker.sources; then
  echo 'Unexpected existing Docker source; refusing to overwrite it.' >&2
  exit 1
fi
apt-get -o DPkg::Lock::Timeout=180 update
docker_version=$(apt-cache policy docker-ce | awk '/Candidate:/ {print $2}')
if [ -z "$docker_version" ] || [ "$docker_version" = '(none)' ]; then
  echo 'No stable Docker package candidate.' >&2
  exit 1
fi
apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends \
  "docker-ce=$docker_version" "docker-ce-cli=$docker_version" \
  containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker nginx
systemctl enable --now certbot.timer
# Existing ubuntu SSH user already has sudo; apply group on the next SSH login.
usermod -aG docker ubuntu

echo 'Verifying services and installed versions.'
docker --version
docker compose version
docker buildx version
nginx -t
certbot --version
systemctl is-active docker nginx
systemctl is-enabled docker nginx certbot.timer
docker run --rm hello-world
curl --fail --silent --output /dev/null --write-out 'Local Nginx HTTP: %{http_code}\n' http://127.0.0.1/
dpkg-query -W -f='${Package} ${Version}\n' \
  docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  nginx certbot python3-certbot-nginx git curl jq unzip
df -h /
echo 'HOST_PREREQUISITES_OK'
