"""
data_syncer.py
IoT Data Syncer - Daily SQLite partition + hybrid sensor/event system
"""

import time
import json
import sqlite3
import os
import csv
import shutil
import subprocess
from datetime import datetime
import threading

import redis as redis_lib

# ───────────────────────── CONFIG ─────────────────────────

SD2_MOUNT = "/mnt/sd2"
DATA_DIR  = f"{SD2_MOUNT}/data"

REDIS_HOST = "localhost"

BUFFER_KEY = "sensor_buffer"
EVENT_QUEUE = "event_queue"

FLUSH_EVERY = 180   # 3 minutes
FLUSH_COUNT = 50

EXPORT_HOUR = 2

MOUNT_SCRIPT = "/home/pi/GATEWAY/scripts/mount_sd2.sh"


# ───────────────────── GLOBAL STATE ───────────────────────

current_date = None
db_path = None
conn = None


# ───────────────────── DB HELPERS ─────────────────────────

def get_redis():
    return redis_lib.Redis(host=REDIS_HOST, port=6379, decode_responses=True)


def is_sd2_available():
    return os.path.ismount(SD2_MOUNT)


def debug_sd2():
    print("\n[SD2 DEBUG]")
    print("ismount:", os.path.ismount(SD2_MOUNT))
    print("exists :", os.path.exists(SD2_MOUNT))
    print("data dir:", os.path.exists(DATA_DIR))
    print("writable:", os.access(DATA_DIR, os.W_OK))

    test_file = os.path.join(DATA_DIR, ".test")
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        print("write test: OK")
    except Exception as e:
        print("write test: FAIL ->", e)


def ensure_sd2_mounted():
    if is_sd2_ready():
        return True

    try:
        result = subprocess.run(
            ["sudo", MOUNT_SCRIPT],
            capture_output=True,
            text=True,
            timeout=15
        )
        return result.returncode == 0
    except Exception as e:
        print(f"[SYNCER] ensure_sd2_mounted error: {e}")
        return False


def is_sd2_ready():
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        test_file = os.path.join(DATA_DIR, ".health_check")
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        return True
    except Exception as e:
        print("[SYNCER] SD2 not ready:", e)
        return False


# ───────────────────── DAILY DB ENGINE ────────────────────

def build_db_path(date_str):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
    except OSError as exc:
        print(f"[SYNCER] ERROR: Unable to prepare SD2 data dir: {exc}")
        raise
    return f"{DATA_DIR}/data_{date_str}.db"


def init_db():
    global conn, db_path, current_date

    today = datetime.now().strftime("%Y-%m-%d")
    current_date = today

    db_path = build_db_path(today)
    new_db = not os.path.exists(db_path)

    try:
        conn = sqlite3.connect(db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")

        if new_db:
            create_schema(conn)

        print(f"[SYNCER] DB ready: {db_path}")
    except sqlite3.OperationalError as exc:
        print(f"[SYNCER] ERROR: Cannot open DB {db_path}: {exc}")
        raise


def create_schema(c):
    c.executescript("""
    CREATE TABLE IF NOT EXISTS sensor_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room TEXT,
        type TEXT,
        value REAL,
        timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        payload TEXT,
        timestamp TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sensor_time
    ON sensor_data(timestamp);
    CREATE INDEX IF NOT EXISTS idx_event_time
    ON system_events(timestamp);    """)
    c.commit()


def rotate_if_needed():
    global conn

    today = datetime.now().strftime("%Y-%m-%d")

    if today != current_date:
        print("[SYNCER] Rotating DB to new day...")

        conn.close()
        init_db()


# ───────────────────── SENSOR BUFFER ──────────────────────

def push_sensor(r, room, sensor_type, value):
    data = json.dumps({
        "room": room,
        "type": sensor_type,
        "value": value,
        "timestamp": datetime.now().isoformat()
    })
    r.rpush(BUFFER_KEY, data)


def flush_sensor():
    global conn

    r = get_redis()
    count = r.llen(BUFFER_KEY)

    if count == 0:
        return 0

    rows = []
    read_count = min(count, FLUSH_COUNT)

    for _ in range(read_count):
        raw = r.lpop(BUFFER_KEY)
        if not raw:
            break

        try:
            d = json.loads(raw)
            rows.append((
                d["room"],
                d["type"],
                float(d["value"]),
                d.get("timestamp", datetime.now().isoformat())
            ))
        except Exception:
            pass

    if rows:
        conn.executemany(
            "INSERT INTO sensor_data (room, type, value, timestamp) VALUES (?,?,?,?)",
            rows
        )
        conn.commit()

    return len(rows)


# ───────────────────── EVENT LOGGER ───────────────────────

def log_event(event_type, payload):
    global conn

    conn.execute(
        "INSERT INTO system_events (type, payload, timestamp) VALUES (?,?,?)",
        (
            event_type,
            json.dumps(payload),
            datetime.now().isoformat()
        )
    )
    conn.commit()


def flush_events():
    global conn

    r = get_redis()
    rows = []

    while True:
        raw = r.lpop(EVENT_QUEUE)
        if not raw:
            break

        try:
            evt = json.loads(raw)
            event_type = evt.get("event") or evt.get("type") or "system"
            payload = evt
            timestamp = evt.get("timestamp", datetime.now().isoformat())
            rows.append((event_type, json.dumps(payload), timestamp))
        except Exception:
            pass

    if rows:
        conn.executemany(
            "INSERT INTO system_events (type, payload, timestamp) VALUES (?,?,?)",
            rows
        )
        conn.commit()

    return len(rows)


# ───────────────────── CSV EXPORT ─────────────────────────

def export_csv():
    if not is_sd2_ready():
        if not ensure_sd2_mounted():
            return

    export_dir = f"{SD2_MOUNT}/exports"
    os.makedirs(export_dir, exist_ok=True)

    filename = f"data_{current_date}.csv"
    path = os.path.join(export_dir, filename)

    rows = conn.execute("SELECT * FROM sensor_data").fetchall()

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["room", "type", "value", "timestamp"])

        for r in rows:
            w.writerow([r["room"], r["type"], r["value"], r["timestamp"]])

    print(f"[SYNCER] CSV exported: {path}")


def backup_db():
    dst = f"{SD2_MOUNT}/data_backup_{current_date}.db"
    shutil.copy2(db_path, dst)
    print(f"[SYNCER] Backup: {dst}")


# ───────────────────── SNAPSHOT ───────────────────────────

def snapshot(r):
    try:
        wifi = r.get("system_status:wifi")
        wifi = json.loads(wifi) if wifi else {}

        conn.execute(
            "INSERT INTO system_events (type, payload, timestamp) VALUES (?,?,?)",
            (
                "snapshot",
                json.dumps(wifi),
                datetime.now().isoformat()
            )
        )
        conn.commit()
    except:
        pass


# ───────────────────── MAIN LOOP ──────────────────────────

def run():
    global conn

    r = get_redis()

    print("[SYNCER] SD2 startup health check")
    debug_sd2()

    while True:
        if is_sd2_ready():
            break

        print("[SYNCER] SD2 not ready → retrying mount/check...")
        debug_sd2()
        ensure_sd2_mounted()
        time.sleep(5)

    while True:
        try:
            init_db()
            break
        except Exception as exc:
            print(f"[SYNCER] init_db failed: {exc}")
            debug_sd2()
            time.sleep(5)

    last_flush = time.time()
    last_snapshot = time.time()
    last_export = None

    print("[SYNCER] Started")

    while True:
        try:
            if not is_sd2_ready():
                print("[SYNCER] SD2 not ready during runtime → retrying mount/check...")
                debug_sd2()
                ensure_sd2_mounted()
                time.sleep(5)
                continue

            rotate_if_needed()

            flushed_events = flush_events()
            if flushed_events:
                print(f"[SYNCER] Flushed {flushed_events} events")

            now = time.time()

            # SENSOR FLUSH (3 min)
            if (now - last_flush) >= FLUSH_EVERY:
                flushed = flush_sensor()
                if flushed:
                    print(f"[SYNCER] Flushed {flushed} sensors")
                last_flush = now

            # SNAPSHOT
            if (now - last_snapshot) > 600:
                snapshot(r)
                last_snapshot = now

            # DAILY EXPORT
            hour = datetime.now().hour
            today = datetime.now().date()

            if hour == EXPORT_HOUR and last_export != today:
                export_csv()
                backup_db()
                last_export = today

            time.sleep(2)

        except Exception as e:
            print("[SYNCER ERROR]", e)
            time.sleep(5)


# ───────────────────── START ──────────────────────────────

if __name__ == "__main__":
    run()