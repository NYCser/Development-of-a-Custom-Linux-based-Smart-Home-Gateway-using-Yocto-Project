#!/bin/bash
################################################################################
# SmartHome Gateway - Run Script
# Chạy: bash run.sh
################################################################################

echo "════════════════════════════════════════════════════════════════════"
echo "  SmartHome Gateway - Starting..."
echo "════════════════════════════════════════════════════════════════════"
echo ""

cd "$(dirname "$0")"

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found!"
    echo "Please run setup.sh first:"
    echo ""
    echo "  bash setup.sh"
    echo ""
    exit 1
fi

# Activate venv
source venv/bin/activate

# Check if requirements are installed
if ! python3 -c "import redis, paho.mqtt, flask, flask_socketio" 2>/dev/null; then
    echo "❌ Some Python packages are missing!"
    echo "Installing from requirements.txt..."
    pip install -r requirements.txt
fi

# Check system services
echo "[Check] Testing MQTT Broker..."
if ! redis-cli -x <<< "PING" &>/dev/null; then
    echo "Starting Redis..."
    sudo systemctl start redis-server
fi

echo "[Check] Testing Redis..."
if ! mosquitto_sub -h localhost -t '#' -W 1 &>/dev/null; then
    echo "Starting Mosquitto..."
    sudo systemctl start mosquitto
fi

echo ""
echo "[Start] Gateway is running..."
echo ""
echo "Web interface will be available at:"
echo "  http://$(hostname -I | awk '{print $1}'):5000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Run Gateway
python gateway_main.py
