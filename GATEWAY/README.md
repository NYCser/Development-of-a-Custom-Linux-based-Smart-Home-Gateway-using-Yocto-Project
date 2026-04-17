# 🏠 SmartHome Gateway - Quick Start

**Cài đặt và chạy Gateway Native trên Raspberry Pi**

## ⚡ Quick Setup (2 min)

```bash
cd /home/pi/GATEWAY
chmod +x setup.sh run.sh
bash setup.sh  # Chỉ chạy lần đầu
bash run.sh    # Chạy mỗi lần khởi động
```

## 🌐 Access Gateway

```
Web UI: http://<raspberry-pi-ip>:5000
```

Tìm IP:
```bash
hostname -I
```

## 📋 What's Inside

| Component | Port | Purpose |
|-----------|------|---------|
| **Flask API** | 5000 | Web interface + REST API |
| **MQTT Broker** | 1883 | Message hub (ESP32 ↔ Gateway) |
| **Redis** | 6379 | Cache + Pubsub |
| **Hotspot** | WiFi | SmartHome_Hub (ESP32 access) |

## 👷 Workers Running

- `safety_watchdog.py` - ⚠️ Gas/Fire detection (priority)
- `automation_engine.py` - Logic & scheduling
- `data_syncer.py` - Daily SQLite files on SD2 + Redis buffer/event persistence
- `network_watchdog.py` - WiFi + RTC + Hotspot

## 📖 Full Guide

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed setup, troubleshooting, and systemd service.

## 🔧 Manual Run

If you prefer manual control:

```bash
# 1. Activate venv
cd /home/pi/GATEWAY
source venv/bin/activate

# 2. Make sure services are running
sudo systemctl start mosquitto
sudo systemctl start redis-server

# 3. Run Gateway
python gateway_main.py
```

## ✅ System Check

```bash
# Check services status
sudo systemctl status mosquitto redis-server

# Test connections
mosquitto_sub -h localhost -t '#' -W 1
redis-cli ping

# Check logs
sudo journalctl -u mosquitto -f
sudo journalctl -u redis-server -f
```

---

**Created**: April 1, 2026 | **Target**: Raspberry Pi | **Mode**: Native Python
