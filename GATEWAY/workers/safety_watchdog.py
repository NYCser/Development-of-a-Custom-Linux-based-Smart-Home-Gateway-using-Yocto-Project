"""
workers/safety_watchdog.py
══════════════════════════
Daemon ưu tiên cao nhất – giám sát Gas / Lửa.

Đặc điểm:
  - Chạy độc lập, KHÔNG phụ thuộc Web hay mạng ngoài
  - Khi phát hiện nguy hiểm: bật quạt + hú còi + lưu alert + push Web
  - Sau khi user "Mute/Xác nhận": tạm im 10 phút, nhưng NẾU vẫn còn
    gas/lửa thì báo động lại sau SAFETY_REPEAT_INTERVAL giây
  - Trong lúc nguy hiểm: KHÓA lệnh điều khiển thủ công từ Web
    (ghi vào Redis key "safety_lock:{room}")
"""

import time
import json
import sqlite3
from datetime import datetime
from bridge.message_bus import MessageBus, CH_INBOUND

# ── Config ────────────────────────────────────────────────
SAFETY_MUTE_TIMEOUT     = 600   # 10 phút im sau khi user mute
SAFETY_REPEAT_INTERVAL  = 300   # 5 phút → báo lại nếu vẫn còn nguy hiểm
WATCHDOG_TICK           = 1.0   # giây
GAS_DEFAULT_THRESHOLD   = 600
DB_PATH                 = "/data/smarthome.db"

DEVICE_MAP = {
    "kitchen_01":     {"fan": "fan_kt_1",  "light": "light_kt_1"},
    "living_room_01": {"fan": "fan_lv_1",  "light": "light_lv_1"},
    "bedroom_01":     {"fan": "fan_bd_1",  "light": "light_bd_1"},
}

# ── State ─────────────────────────────────────────────────
SAFETY_STATE: dict = {}   # {room_id: {muted, mute_time, last_alert}}
CACHED_SENSORS: dict = {}  # shared với automation_engine qua module import


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _get_rule(room_id: str) -> dict:
    conn = get_db()
    row  = conn.execute("SELECT * FROM automations WHERE room_id=?", (room_id,)).fetchone()
    conn.close()
    return dict(row) if row else {}


def _save_alert(room_id: str, alert_type: str, message: str):
    """Lưu alert vào SQLite + thông báo + Redis."""
    bus = MessageBus.get_instance()
    try:
        conn = get_db()
        now  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "INSERT INTO system_alerts (room, type, message, level, timestamp) VALUES (?,?,?,?,?)",
            (room_id, alert_type, message, "critical", now)
        )
        conn.execute(
            "INSERT INTO notifications (type, title, message, room, created_at) VALUES (?,?,?,?,?)",
            (alert_type.upper() + "_ALERT",
             "GAS ALERT" if alert_type == "gas" else "FIRE ALERT",
             message, room_id, now)
        )
        conn.commit()
        conn.close()

        # Push lên Web qua Redis realtime
        bus.publish_event("realtime_data", {
            "event":   "new_alert",
            "type":    alert_type,
            "room":    room_id,
            "message": message,
            "level":   "critical",
            "timestamp": now
        })
        # Giữ trạng thái cảnh báo trong Redis để Web biết sau khi F5
        bus.get_redis().setex(
            f"active_alert:{room_id}",
            SAFETY_MUTE_TIMEOUT * 2,
            json.dumps({"type": alert_type, "message": message, "timestamp": now})
        )
    except Exception as e:
        print(f"[WATCHDOG] save_alert error: {e}")


def _set_safety_lock(room_id: str, locked: bool):
    """Khoá/mở lệnh điều khiển thủ công từ Web."""
    bus = MessageBus.get_instance()
    key = f"safety_lock:{room_id}"
    if locked:
        bus.get_redis().setex(key, SAFETY_REPEAT_INTERVAL + 60, "1")
        bus.publish_event("realtime_data", {
            "event": "safety_lock", "room": room_id, "locked": True
        })
    else:
        bus.get_redis().delete(key)
        bus.publish_event("realtime_data", {
            "event": "safety_lock", "room": room_id, "locked": False
        })


def _trigger_safety_action(bus: MessageBus, room_id: str, alert_type: str, value: float):
    """Bắn lệnh phần cứng khi có nguy hiểm."""
    fan_id = DEVICE_MAP.get(room_id, {}).get("fan")
    if fan_id:
        bus.publish_mqtt(f"home/{room_id}/command", {
            "device": fan_id, "action": "turn_on", "source": "safety"
        })
    # Hú còi buzzer qua topic chung
    bus.publish_mqtt(f"home/{room_id}/command", {
        "action": "buzz_alarm", "type": alert_type, "value": value
    })
    _set_safety_lock(room_id, True)


def _mute_safety_action(bus: MessageBus, room_id: str):
    """Tắt còi khi user mute."""
    bus.publish_mqtt(f"home/{room_id}/command", {"action": "mute_alarm"})


def run():
    """Vòng lặp watchdog chính – chạy trong thread daemon."""
    bus   = MessageBus.get_instance()
    redis = bus.get_redis()

    # Lắng nghe lệnh mute từ Web (qua Redis)
    def listen_mute():
        pubsub = redis.pubsub()
        pubsub.subscribe("alert_commands")
        for msg in pubsub.listen():
            if msg["type"] != "message": continue
            try:
                data    = json.loads(msg["data"])
                action  = data.get("action")
                room_id = data.get("room_id")
                if action == "mute" and room_id:
                    state = SAFETY_STATE.setdefault(room_id, {})
                    state["muted"]     = True
                    state["mute_time"] = datetime.now()
                    _mute_safety_action(bus, room_id)
                    print(f"[WATCHDOG] {room_id} muted by user")
            except Exception as e:
                print(f"[WATCHDOG] mute listener error: {e}")

    import threading
    threading.Thread(target=listen_mute, daemon=True).start()

    print("[WATCHDOG] Safety watchdog started")
    while True:
        try:
            now = datetime.now()
            # Kiểm tra tất cả phòng có rule
            conn  = get_db()
            rules = conn.execute("SELECT * FROM automations WHERE enabled=1").fetchall()
            conn.close()

            for rule_row in rules:
                rule    = dict(rule_row)
                room_id = rule["room_id"]
                sensors = CACHED_SENSORS.get(room_id, {})
                state   = SAFETY_STATE.setdefault(room_id, {
                    "muted": False, "mute_time": None, "last_alert": None
                })

                gas_threshold = float(rule.get("gas_threshold") or GAS_DEFAULT_THRESHOLD)
                current_gas   = float(sensors.get("gas", 0))
                is_fire       = bool(sensors.get("fire_detected", False))

                is_dangerous = (current_gas > gas_threshold) or is_fire
                alert_type   = "fire" if is_fire else "gas"
                alert_msg    = (f"PHÁT HIỆN LỬA! Phòng: {room_id}" if is_fire
                                else f"RÒ RỈ KHÍ GAS! {current_gas:.0f} ppm - Phòng: {room_id}")

                if is_dangerous:
                    _trigger_safety_action(bus, room_id, alert_type, current_gas)

                    if state.get("muted"):
                        mute_time = state.get("mute_time")
                        elapsed   = (now - mute_time).total_seconds() if mute_time else 9999
                        if elapsed > SAFETY_MUTE_TIMEOUT:
                            # Hết thời gian mute → báo lại
                            state["muted"] = False
                            print(f"[WATCHDOG] {room_id}: mute timeout, re-alerting")
                        # Vẫn trong thời gian mute nhưng đã qua REPEAT_INTERVAL → báo lại
                        last = state.get("last_alert")
                        if last and (now - last).total_seconds() > SAFETY_REPEAT_INTERVAL:
                            _save_alert(room_id, alert_type, alert_msg)
                            state["last_alert"] = now
                    else:
                        last = state.get("last_alert")
                        if not last or (now - last).total_seconds() > SAFETY_REPEAT_INTERVAL:
                            _save_alert(room_id, alert_type, alert_msg)
                            state["last_alert"] = now
                else:
                    # Hết nguy hiểm → mở khoá
                    if state.get("last_alert") is not None:
                        _set_safety_lock(room_id, False)
                        state["last_alert"] = None
                        state["muted"]      = False
                        # Thông báo an toàn
                        bus.publish_event("realtime_data", {
                            "event":   "new_alert",
                            "type":    "system",
                            "room":    room_id,
                            "message": f"thanh cong {room_id} đã an toàn.",
                            "level":   "info",
                            "timestamp": now.strftime("%Y-%m-%d %H:%M:%S")
                        })

            time.sleep(WATCHDOG_TICK)

        except Exception as e:
            print(f"[WATCHDOG] loop error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    run()
