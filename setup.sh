#!/bin/bash
################################################################################
# SmartHome Gateway - Setup Script for Raspberry Pi (Native Python)
# Chạy: bash setup.sh
################################################################################

set -e  # Exit on any error

echo "════════════════════════════════════════════════════════════════════"
echo "  SmartHome Gateway - Native Python Setup (Raspberry Pi)"
echo "════════════════════════════════════════════════════════════════════"

# ── Step 1: Update system packages ────────────────────────────────────

echo ""
echo "[Step 1] Updating system packages..."
sudo apt update
sudo apt install -y \
  python3 python3-venv python3-pip \
  build-essential libssl-dev libffi-dev python3-dev \
  mosquitto mosquitto-clients \
  redis-server redis-tools \
  network-manager \
  git curl wget

# ── Step 2: Create/activate venv ──────────────────────────────────────

echo ""
echo "[Step 2] Setting up Python virtual environment..."

if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo "✓ Created new venv"
else
    echo "✓ venv already exists"
fi

source venv/bin/activate

# ── Step 3: Upgrade pip & install dependencies ────────────────────────

echo ""
echo "[Step 3] Installing Python dependencies..."
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# ── Step 4: Enable and start system services ──────────────────────────

echo ""
echo "[Step 4] Setting up system services (MQTT & Redis)..."

# Mosquitto MQTT Broker
sudo systemctl unmask mosquitto || true
sudo systemctl enable mosquitto
sudo systemctl start mosquitto
echo "✓ Mosquitto started"

# Redis Server
sudo systemctl enable redis-server
sudo systemctl start redis-server
echo "✓ Redis started"

# ── Step 5: Create data directory ─────────────────────────────────────

echo ""
echo "[Step 5] Creating data directories..."

sudo mkdir -p /data
sudo chown $USER:$USER /data
chmod 755 /data

echo "✓ Data directory ready: /data"

# ── Step 6: Test connections ─────────────────────────────────────────

echo ""
echo "[Step 6] Testing service connections..."

# Test MQTT
if mosquitto_sub -h localhost -t '' -W 1 &> /dev/null; then
    echo "✓ MQTT Broker (Mosquitto) is running on localhost:1883"
else
    echo "✗ MQTT Broker failed - check with: sudo systemctl status mosquitto"
fi

# Test Redis
if redis-cli ping | grep -q "PONG"; then
    echo "✓ Redis is running on localhost:6379"
else
    echo "✗ Redis failed - check with: sudo systemctl status redis-server"
fi

# ── Step 7: Display startup commands ──────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  ✓ Setup Complete!"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "To start Gateway, run:"
echo ""
echo "  cd /home/pi/GATEWAY"
echo "  source venv/bin/activate"
echo "  python gateway_main.py"
echo ""
echo "To view logs:"
echo "  - MQTT:  mosquitto_sub -h localhost -t 'home/#'"
echo "  - Redis: redis-cli MONITOR"
echo ""
echo "════════════════════════════════════════════════════════════════════"

deactivate
