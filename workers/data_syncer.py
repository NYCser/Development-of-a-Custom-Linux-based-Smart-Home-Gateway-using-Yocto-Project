"""
workers/data_syncer_spi.py
══════════════════════════
Phiên bản sử dụng Module Micro SD SPI Adapter thay vì USB.
"""

import time
import json
import sqlite3
import os
import csv
from datetime import datetime
import redis as redis_lib

# Optional CircuitPython imports (for SPI SD Card)
try:
    import busio
    import digitalio
    import board
    import adafruit_sdcard
    import storage
    CIRCUITPYTHON_AVAILABLE = True
except ImportError:
    print("[SYNCER] ⚠️  CircuitPython libraries not available - SD card via SPI will be skipped")
    CIRCUITPYTHON_AVAILABLE = False

# ── Cấu hình SPI ──────────────────────────────────────────
# Chân CS (Chip Select) thường nối vào GPIO 8 (CE0)
if CIRCUITPYTHON_AVAILABLE:
    SD_CS_PIN = board.D8
MOUNT_PATH = "/mnt/sd2"

# Các cấu hình cũ
DB_PATH      = "/data/smarthome.db"
REDIS_HOST   = "localhost"
BUFFER_KEY   = "sensor_buffer"
FLUSH_EVERY  = 300 
FLUSH_COUNT  = 100
EXPORT_HOUR  = 2

def setup_spi_sd():
    """Khởi tạo driver SPI và mount thẻ nhớ vào hệ thống"""
    if not CIRCUITPYTHON_AVAILABLE:
        print("[SYNCER] CircuitPython not available - skipping SPI SD card setup")
        return False
    
    try:
        # Tạo thư mục mount nếu chưa có
        if not os.path.exists(MOUNT_PATH):
            os.makedirs(MOUNT_PATH)

        # Khởi tạo bus SPI
        spi = busio.SPI(board.SCK, board.MOSI, board.MISO)
        cs = digitalio.DigitalInOut(SD_CS_PIN)
        
        # Khởi tạo đối tượng SD Card
        sdcard = adafruit_sdcard.SDCard(spi, cs)
        vfs = storage.VfsFat(sdcard)
        
        # Mount vào file system của Linux
        storage.mount(vfs, MOUNT_PATH)
        print(f"[SYNCER] Đã mount thẻ SD qua SPI tại {MOUNT_PATH}")
        return True
    except Exception as e:
        print(f"[SYNCER] Lỗi khởi tạo thẻ SD SPI: {e}")
        return False

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_redis():
    return redis_lib.Redis(host=REDIS_HOST, port=6379, decode_responses=True)

# ── Các hàm xử lý dữ liệu (giữ nguyên logic nhưng thêm kiểm tra mount) ──

def backup_db_to_sd2():
    """Sao lưu file DB sang thẻ SD SPI"""
    # Lưu ý: Với SPI, tốc độ sẽ chậm hơn USB, nên dùng lệnh copy khối nhỏ
    dest = os.path.join(MOUNT_PATH, "smarthome_backup.db")
    try:
        import shutil
        shutil.copy2(DB_PATH, dest)
        print(f"[SYNCER] Backup DB to SPI SD thành công: {dest}")
    except Exception as e:
        print(f"[SYNCER] Backup lỗi: {e}")

def export_csv_to_sd2():
    """Xuất dữ liệu sensor ra CSV trên thẻ SD SPI"""
    if not os.path.ismount(MOUNT_PATH):
        print("[SYNCER] Thẻ SD chưa được mount, bỏ qua export.")
        return

    today_str = datetime.now().strftime("%Y%m%d")
    csv_file = os.path.join(MOUNT_PATH, f"sensors_{today_str}.csv")
    
    conn = get_db()
    try:
        cursor = conn.execute("SELECT * FROM system_snapshots ORDER BY timestamp DESC LIMIT 1000")
        rows = cursor.fetchall()
        if rows:
            with open(csv_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow(rows[0].keys()) # Header
                writer.writerows(rows)
            print(f"[SYNCER] Export CSV to SPI SD thành công: {csv_file}")
    except Exception as e:
        print(f"[SYNCER] Export lỗi: {e}")
    finally:
        conn.close()

# ── Buffer flush logic ────────────────────────────────────

def flush_buffer():
    """Lấy từ Redis buffer → ghi vào SQLite sensor_data"""
    r = get_redis()
    conn = get_db()
    count = 0
    
    while True:
        item = r.lpop(BUFFER_KEY)
        if not item:
            break
        
        try:
            data = json.loads(item)
            room = data.get("room", "unknown")
            sensor_type = data.get("type", "unknown")
            value = data.get("value", 0)
            timestamp = data.get("timestamp", datetime.now().isoformat())
            
            conn.execute(
                "INSERT INTO sensor_data (room, type, value, timestamp) VALUES (?, ?, ?, ?)",
                (room, sensor_type, value, timestamp)
            )
            count += 1
        except Exception as e:
            print(f"[SYNCER] Flush error on item: {e}")
    
    conn.commit()
    conn.close()
    if count > 0:
        print(f"[SYNCER] Flushed {count} records to SQLite")

# ── Main Loop ──────────────────────────────────────────────

def run():
    # Bước 1: Thử mount thẻ SD
    sd_ready = setup_spi_sd()
    
    r = get_redis()
    last_flush = time.time()
    
    print("[SYNCER] Data syncer (SPI Version) started")

    while True:
        try:
            now = time.time()
            
            # Kiểm tra buffer và flush vào SQLite (Thẻ nhớ OS)
            buf_len = r.llen(BUFFER_KEY)
            if buf_len >= FLUSH_COUNT or (now - last_flush) >= FLUSH_EVERY:
                flush_buffer()
                last_flush = now

            # Export định kỳ sang thẻ SD2 (Thẻ SPI)
            current_hour = datetime.now().hour
            if current_hour == EXPORT_HOUR and sd_ready:
                export_csv_to_sd2()
                backup_db_to_sd2()
                time.sleep(3600) # Tránh lặp lại trong cùng 1 giờ

            time.sleep(10)
        except Exception as e:
            print(f"[SYNCER] Loop error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    run()
