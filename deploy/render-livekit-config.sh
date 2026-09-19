#!/bin/sh
set -eu

: "${LIVEKIT_API_KEY:?LIVEKIT_API_KEY is required}"
case "$LIVEKIT_API_KEY" in *[!A-Za-z0-9_-]*) echo 'LIVEKIT_API_KEY may contain only letters, numbers, _ and -' >&2; exit 1;; esac

output=${1:-livekit.generated.yaml}
umask 077
cat > "$output" <<EOF
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
logging:
  level: info
webhook:
  api_key: $LIVEKIT_API_KEY
  urls:
    - http://app:3000/api/v2/voice/webhook
EOF
echo "Generated $output"
