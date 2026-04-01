"""
gateway_main.py
═══════════════
Entry point khởi động toàn bộ Gateway Local SmartHome.
Chạy: python gateway_main.py

Thứ tự khởi động:
  1. Init DB (tạo bảng nếu chưa có)
  2. MessageBus (MQTT ↔ Redis)
  3. Safety Watchdog (ưu tiên cao nhất)
  4. Automation Engine (logic + scheduler + RFID)
  5. Data Syncer (buffer Redis → SQLite + SD2 backup)
  6. Network Watchdog (WiFi + RTC sync)
  7. Flask API + SocketIO (Web interface)
"""

import threading
import sqlite3
import os
import sys

# Thêm project root vào path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DB_PATH    = os.getenv("DB_PATH",     "/data/smarthome.db")
REDIS_HOST = os.getenv("REDIS_HOST",  "localhost")
MQTT_HOST  = os.getenv("MQTT_BROKER", "localhost")


# ── 1. Init DB ────────────────────────────────────────────

def init_db():
    schema_path = os.path.join(os.path.dirname(__file__), "storage/db_schema.sql")
    conn        = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    if os.path.exists(schema_path):
        with open(schema_path, "r") as f:
            conn.executescript(f.read())
        print("[MAIN] DB schema applied")
    else:
        print("[MAIN] Warning: db_schema.sql not found, DB may be incomplete")

    conn.commit()
    conn.close()


# ── 2. Khởi động các worker ───────────────────────────────

def start_workers():
    from bridge.message_bus     import MessageBus
    from workers                import safety_watchdog, automation_engine, data_syncer, network_watchdog

    # MessageBus (phải khởi động trước)
    bus = MessageBus.get_instance()
    bus.connect()

    # Safety Watchdog – daemon với ưu tiên cao nhất
    threading.Thread(target=safety_watchdog.run,    name="SafetyWatchdog",  daemon=True).start()

    # Network Watchdog – bao gồm hotspot + RTC
    threading.Thread(target=network_watchdog.run,   name="NetworkWatchdog", daemon=True).start()

    # Data Syncer – buffer Redis → SQLite
    threading.Thread(target=data_syncer.run,        name="DataSyncer",      daemon=True).start()

    # Automation Engine – blocking (chứa Redis pubsub listener)
    threading.Thread(target=automation_engine.run,  name="AutomationEngine",daemon=False).start()

    print("[MAIN] All workers started")


# ── 3. Flask API ──────────────────────────────────────────

def start_api():
    from app.main import app, socketio
    # Import routes (gắn blueprints)
    from app.api.routes.all_routes import (
        auth_bp, sensors_bp, devices_bp, automation_bp,
        logs_bp, rfid_bp, wifi_bp, ota_bp, system_bp
    )
    for bp in [auth_bp, sensors_bp, devices_bp, automation_bp,
               logs_bp, rfid_bp, wifi_bp, ota_bp, system_bp]:
        try:
            app.register_blueprint(bp)
        except AssertionError:
            pass  # Blueprint đã đăng ký

    port = int(os.getenv("API_PORT", 5000))
    print(f"[MAIN] Flask API starting on port {port}")
    socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)


# ── Main ──────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 55)
    print("  SmartHome Gateway – Local/Offline Mode")
    print("  MQTT + SQLite + Redis | No Cloud Required")
    print("=" * 55)

    init_db()
    start_workers()
    start_api()   # Blocking – Flask chạy trên main thread
