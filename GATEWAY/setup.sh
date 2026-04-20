
#!/bin/bash
################################################################################
# SmartHome Gateway - Setup Script for Raspberry Pi (Native Python)
# Usage: bash setup.sh
################################################################################

set -e  # Exit on any error

echo "════════════════════════════════════════════════════════════════════"
echo "  SmartHome Gateway - Native Python Setup (Raspberry Pi)"
echo "════════════════════════════════════════════════════════════════════"

# ── Step 1: Update system packages ────────────────────────────────────

# echo ""
# echo "[Step 1] Updating system packages..."

# sudo apt update
# sudo apt install -y \
#   python3 python3-venv python3-pip \
#   build-essential libssl-dev libffi-dev python3-dev \
#   mosquitto mosquitto-clients \
#   redis-server redis-tools \
#   network-manager \
#   git curl wget netcat-openbsd

# ── Step 2: Create/activate venv ──────────────────────────────────────

# echo ""
# echo "[Step 2] Setting up Python virtual environment..."

# if [ ! -d "venv" ]; then
#     python3 -m venv venv
#     echo "✓ Created new venv"
# else
#     echo "✓ venv already exists"
# fi

# source venv/bin/activate

# ── Step 3: Install Python dependencies ───────────────────────────────

# echo ""
# echo "[Step 3] Installing Python dependencies..."

# pip install --upgrade pip setuptools wheel
# pip install -r requirements.txt

# ── Step 1: Setup services ────────────────────────────────────────────

echo ""
echo "[Step 1] Setting up system services (MQTT & Redis)..."

# Mosquitto
sudo systemctl unmask mosquitto || true
sudo systemctl enable mosquitto
sudo systemctl restart mosquitto

# Redis
sudo systemctl enable redis-server
sudo systemctl restart redis-server

echo "✓ Services started"

# ── Step 2: Create data directory ─────────────────────────────────────

echo ""
echo "[Step 2] Creating data directory..."

sudo mkdir -p /data
sudo chown $USER:$USER /data
chmod 755 /data

echo "✓ Data directory ready: /data"
# ── Step 2B: Setup SD2 USB Mount ──────────────────────────────────

echo ""
echo "[Step 2B] Setting up External Storage (SD2) mount..."

# Create mount point
sudo mkdir -p /mnt/sd2
sudo chown $USER:$USER /mnt/sd2
chmod 755 /mnt/sd2

# Install mount script
mkdir -p scripts
chmod +x scripts/mount_sd2.sh

# Install systemd service for auto-mount
sudo cp scripts/sd2-mount@.service /etc/systemd/system/
sudo cp scripts/99-sd2-mount.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo systemctl daemon-reload

echo "✓ SD2 auto-mount configured"
echo "  Mount point: /mnt/sd2"
echo "  To manually mount: sudo ./scripts/mount_sd2.sh"
# ── Step 3: Test connections ─────────────────────────────────────────

echo ""
echo "[Step 3] Testing service connections..."

### MQTT TEST (CORRECT WAY)
echo "- Testing MQTT..."

MQTT_TEST=$(mktemp)

mosquitto_sub -h localhost -t test/topic -C 1 > "$MQTT_TEST" &
SUB_PID=$!

sleep 0.5

mosquitto_pub -h localhost -t test/topic -m "ping"

wait $SUB_PID 2>/dev/null || true

if grep -q "ping" "$MQTT_TEST"; then
    echo "✓ MQTT Broker working (pub/sub OK)"
else
    echo "✗ MQTT test failed"
fi

rm -f "$MQTT_TEST"

### MQTT PORT CHECK
if nc -z localhost 1883; then
    echo "✓ MQTT port 1883 is open"
else
    echo "✗ MQTT port 1883 is NOT open"
fi

### REDIS TEST
echo "- Testing Redis..."

if redis-cli ping | grep -q "PONG"; then
    echo "✓ Redis is running on localhost:6379"
else
    echo "✗ Redis failed"
fi

# ── Step 4: Done ─────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  ✓ Setup Complete!"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "To start Gateway:"
echo "  cd ~/GATEWAY"
echo "  source venv/bin/activate"
echo "  python gateway_main.py"
echo ""
echo "To debug:"
echo "  MQTT  → mosquitto_sub -h localhost -t '#'"
echo "  Redis → redis-cli MONITOR"
echo ""
echo "════════════════════════════════════════════════════════════════════"

# deactivate

