#!/bin/bash
# GTPL Playwright Service — start service + tunnel + update production
# Usage: bash /home/administrator/cabletv-app/backend/start_gtpl.sh

set -e
cd /home/administrator/cabletv-app/backend
source venv/bin/activate

PORT=8199
TOKEN="gtpl_secret_2026"
ENV_FILE="/tmp/gtpl_env_new.txt"
TUNNEL_LOG="/tmp/gtpl_tunnel.log"

echo "=== Starting GTPL Playwright Service on port $PORT ==="

# Kill existing service if any
pkill -f "python gtpl_service.py" 2>/dev/null || true
sleep 1

# Start service in background
nohup python gtpl_service.py > /tmp/gtpl_service.log 2>&1 &
SERVICE_PID=$!
echo "Service PID: $SERVICE_PID"

# Wait for service to be ready
for i in $(seq 1 15); do
    if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
        echo "✅ Service ready on port $PORT"
        break
    fi
    sleep 1
done

# Kill existing tunnel if any
pkill -f "cloudflared.*8199" 2>/dev/null || true
sleep 1

# Start tunnel
echo "=== Starting Cloudflare tunnel ==="
rm -f $TUNNEL_LOG

~/bin/cloudflared tunnel --url http://localhost:$PORT 2>&1 | while IFS= read -r line; do
    echo "$line" >> $TUNNEL_LOG
    if echo "$line" | grep -qoE 'https://[a-z0-9-]+\.trycloudflare\.com'; then
        TUNNEL_URL=$(echo "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)
        echo "$TUNNEL_URL" > /tmp/gtpl_tunnel_url.txt
        echo "✅ Tunnel URL: $TUNNEL_URL"
        
        # Update production .env
        cat > $ENV_FILE << EOF
GTPL_SERVICE_URL=$TUNNEL_URL
GTPL_SERVICE_TOKEN=$TOKEN
EOF
        
        # Upload to production via FTP
        python3 -c "
import ftplib
ftp = ftplib.FTP('rscloud.live', 'auvgoun9kxkv', 'Rajesh@1990')
with open('$ENV_FILE', 'rb') as f:
    ftp.storbinary('STOR cabletv/backend/.env', f)
from io import BytesIO
ftp.storbinary('STOR cabletv/tmp/restart.txt', BytesIO(b'restart'))
ftp.quit()
print('✅ Production .env updated, Passenger restarted')
"
        echo "=== GTPL Service Ready ==="
        echo "   Service: http://localhost:$PORT"
        echo "   Tunnel:  $TUNNEL_URL"
        echo "   Health:  $TUNNEL_URL/health"
    fi
done
