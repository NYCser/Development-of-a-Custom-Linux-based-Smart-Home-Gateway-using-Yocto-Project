-- ═══════════════════════════════════════════════════════════
-- SmartHome Local - SQLite Schema
-- File duy nhất, tất cả bảng dữ liệu
-- PRAGMA journal_mode = WAL  ← chạy khi connect để bảo vệ SD
-- ═══════════════════════════════════════════════════════════

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ──────────────────────────────────────────────────────────
-- 1. NGƯỜI DÙNG & PHIÊN
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT    UNIQUE NOT NULL,
    password     TEXT    NOT NULL,               -- sha256
    display_name TEXT    DEFAULT '',
    role         TEXT    DEFAULT 'user',         -- user | admin
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT    PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    expires_at  TEXT    NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ──────────────────────────────────────────────────────────
-- 2. CẤU TRÚC NHÀ
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
    id          TEXT    PRIMARY KEY,             -- kitchen_01, bedroom_01...
    name        TEXT    NOT NULL,
    icon        TEXT    DEFAULT 'home',
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS devices (
    id          TEXT    PRIMARY KEY,             -- fan_kt_1, light_lv_1...
    room_id     TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    type        TEXT    NOT NULL,               -- fan | light | door | ac
    FOREIGN KEY(room_id) REFERENCES rooms(id)
);

-- ──────────────────────────────────────────────────────────
-- 3. DỮ LIỆU CẢM BIẾN (ghi theo batch)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sensor_data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room        TEXT    NOT NULL,
    type        TEXT    NOT NULL,               -- temperature|humidity|gas|co2|tvoc
    value       REAL    NOT NULL,
    timestamp   TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sensor_room_ts ON sensor_data(room, type, timestamp DESC);

-- ──────────────────────────────────────────────────────────
-- 4. TRẠNG THÁI THIẾT BỊ (realtime snapshot)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_status (
    room        TEXT    NOT NULL,
    device_id   TEXT    NOT NULL,
    is_on       INTEGER DEFAULT 0,
    source      TEXT    DEFAULT 'unknown',      -- web|auto|schedule|safety
    updated_at  TEXT    DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (room, device_id)
);

-- ──────────────────────────────────────────────────────────
-- 5. CẢNH BÁO HỆ THỐNG
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room        TEXT,
    type        TEXT,                           -- gas|fire|system|ota
    message     TEXT,
    level       TEXT    DEFAULT 'info',         -- info|warning|critical
    is_resolved INTEGER DEFAULT 0,
    resolved_at TEXT,
    timestamp   TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_alert_unresolved ON system_alerts(is_resolved, timestamp DESC);

-- ──────────────────────────────────────────────────────────
-- 6. THÔNG BÁO (chuông trên Web)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    message     TEXT    NOT NULL,
    is_read     INTEGER DEFAULT 0,
    room        TEXT    DEFAULT '',
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────
-- 7. LOG ĐĂNG NHẬP
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT,
    success     INTEGER DEFAULT 0,
    ip_address  TEXT,
    device_hint TEXT,
    user_agent  TEXT,
    reason      TEXT,
    timestamp   TEXT    DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────
-- 8. LOG RA VÀO CỬA RFID
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS access_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room        TEXT,
    uid         TEXT,
    user_name   TEXT,
    action      TEXT,                           -- open_door|attempt_failed|enroll
    success     INTEGER DEFAULT 0,
    duration_s  INTEGER,
    timestamp   TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_access_room_ts ON access_logs(room, timestamp DESC);

-- ──────────────────────────────────────────────────────────
-- 9. LOG TỰ ĐỘNG HÓA
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room        TEXT,
    scenario    TEXT,
    actions     TEXT,                           -- JSON array
    triggered_by TEXT,                          -- temperature|gas|schedule|web
    timestamp   TEXT    DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────
-- 10. THẺ RFID
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rfid_cards (
    uid         TEXT    PRIMARY KEY,
    owner_name  TEXT    DEFAULT '',
    is_active   INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────
-- 11. RULES TỰ ĐỘNG HÓA
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automations (
    room_id         TEXT    PRIMARY KEY,
    enabled         INTEGER DEFAULT 1,
    fan_threshold   REAL,
    light_threshold REAL,
    gas_threshold   REAL    DEFAULT 600
);

-- ──────────────────────────────────────────────────────────
-- 12. LỊCH HẸN GIỜ
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id     TEXT    NOT NULL,
    device_id   TEXT    NOT NULL,
    action      TEXT    NOT NULL,               -- turn_on|turn_off
    time        TEXT    NOT NULL,               -- HH:MM
    enabled     INTEGER DEFAULT 1,
    created_at  TEXT    DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────
-- 13. OTA FIRMWARE
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ota_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room        TEXT,
    filename    TEXT,
    url         TEXT,
    status      TEXT    DEFAULT 'sent',         -- sent|success|failed
    triggered_by TEXT,
    timestamp   TEXT    DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────
-- 14. SYSTEM SNAPSHOTS (uptime tracking)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    wifi_ssid    TEXT,
    wifi_status  TEXT,
    room_count   INTEGER DEFAULT 0,
    device_count INTEGER DEFAULT 0,
    alert_count  INTEGER DEFAULT 0,
    timestamp    TEXT    DEFAULT (datetime('now','localtime'))
);

-- ──────────────────────────────────────────────────────────
-- 15. SEED DATA MẶC ĐỊNH
-- ──────────────────────────────────────────────────────────
INSERT OR IGNORE INTO users (email, password, display_name, role)
VALUES ('admin@smarthome.local',
        'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3', -- password: 123
        'Admin', 'admin');

INSERT OR IGNORE INTO rooms (id, name, icon) VALUES
    ('bedroom_01',    'Phòng Ngủ',  'bed'),
    ('kitchen_01',    'Nhà Bếp',    'utensils'),
    ('living_room_01','Phòng Khách','sofa');

INSERT OR IGNORE INTO devices (id, room_id, name, type) VALUES
    ('fan_bd_1',   'bedroom_01',     'Quạt',  'fan'),
    ('light_bd_1', 'bedroom_01',     'Đèn',   'light'),
    ('fan_kt_1',   'kitchen_01',     'Quạt',  'fan'),
    ('light_kt_1', 'kitchen_01',     'Đèn',   'light'),
    ('fan_lv_1',   'living_room_01', 'Quạt',  'fan'),
    ('light_lv_1', 'living_room_01', 'Đèn',   'light');
