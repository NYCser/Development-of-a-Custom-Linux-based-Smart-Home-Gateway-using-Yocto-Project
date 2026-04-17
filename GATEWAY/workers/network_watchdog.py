"""
workers/network_watchdog.py
═══════════════════════════
Quản lý mạng Hybrid:
  - Duy trì Hotspot "SmartHome_Hub" cho ESP32
  - Kết nối WiFi nhà (uplink) khi cần
  - Kiểm tra Internet → sync NTP → ghi vào RTC DS3231
  - Scan WiFi cho trang Cài đặt Web
  - Cập nhật trạng thái vào Redis để Web hiển thị
"""

import time
import json
import subprocess
import threading
from datetime import datetime

import redis as redis_lib

REDIS_HOST   = "localhost"
HOTSPOT_SSID = "SmartHome_Hub"
HOTSPOT_PASS = ""                      # Mạng mở
HOTSPOT_IP   = "10.42.0.1/24"
INTERFACE    = "wlan0"
CHECK_EVERY  = 30                      # giây kiểm tra network


def get_redis():
    return redis_lib.Redis(host=REDIS_HOST, port=6379, decode_responses=True)


# ── Hotspot ────────────────────────────────────────────────

def ensure_hotspot():
    """Tạo / khởi động lại Hotspot nếu chưa active."""
    try:
        # Kiểm tra đã có chưa
        result = subprocess.run(
            f"nmcli -t con show --active | grep '{HOTSPOT_SSID}'",
            shell=True, capture_output=True
        )
        if result.returncode == 0:
            return  # Đang chạy rồi

        subprocess.run(f"sudo nmcli connection delete '{HOTSPOT_SSID}'",
                       shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(f"sudo nmcli dev disconnect {INTERFACE}",
                       shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        cmds = [
            f"sudo nmcli con add type wifi ifname {INTERFACE} con-name '{HOTSPOT_SSID}' autoconnect yes ssid '{HOTSPOT_SSID}'",
            f"sudo nmcli con modify '{HOTSPOT_SSID}' 802-11-wireless.mode ap",
            f"sudo nmcli con modify '{HOTSPOT_SSID}' 802-11-wireless.band bg",
            f"sudo nmcli con modify '{HOTSPOT_SSID}' 802-11-wireless.channel 6",
            f"sudo nmcli con modify '{HOTSPOT_SSID}' remove wifi-sec",   # Mạng mở
            f"sudo nmcli con modify '{HOTSPOT_SSID}' ipv4.addresses {HOTSPOT_IP}",
            f"sudo nmcli con modify '{HOTSPOT_SSID}' ipv4.method manual",
            f"sudo nmcli con modify '{HOTSPOT_SSID}' connection.autoconnect-priority 100",
            f"sudo nmcli con up '{HOTSPOT_SSID}'",
        ]
        for cmd in cmds:
            subprocess.run(cmd, shell=True, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[NET] Hotspot '{HOTSPOT_SSID}' activated at {HOTSPOT_IP}")
    except Exception as e:
        print(f"[NET] Hotspot error: {e}")


# ── Internet check ────────────────────────────────────────

def check_internet() -> bool:
    try:
        subprocess.check_call(
            ["ping", "-c", "1", "-W", "3", "8.8.8.8"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        return True
    except:
        return False


def get_wifi_status() -> dict:
    """Lấy trạng thái kết nối WiFi hiện tại."""
    # Kiểm tra WiFi infrastructure (uplink)
    try:
        cmd    = "nmcli -t -f ACTIVE,SSID,MODE dev wifi | grep '^yes' | grep ':infrastructure'"
        output = subprocess.check_output(cmd, shell=True).decode().strip()
        if output:
            ssid = output.split(":")[1]
            return {"status": "connected", "ssid": ssid, "type": "wifi"}
    except:
        pass

    # Kiểm tra Ethernet
    try:
        subprocess.check_call(
            ["ping", "-c", "1", "-W", "3", "8.8.8.8"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        return {"status": "connected", "ssid": "Ethernet/Wired", "type": "ethernet"}
    except:
        pass

    return {"status": "disconnected", "ssid": "N/A", "type": "none"}


# ── RTC Sync ──────────────────────────────────────────────

def sync_rtc_from_ntp():
    """Nếu có Internet: sync NTP → ghi vào RTC DS3231."""
    try:
        subprocess.run(["sudo", "ntpdate", "-u", "pool.ntp.org"],
                       timeout=10, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["sudo", "hwclock", "-w"],  # Ghi giờ hệ thống vào RTC
                       timeout=5, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[NET] RTC updated from NTP: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    except Exception as e:
        print(f"[NET] NTP sync error: {e}")


def read_rtc_to_system():
    """Nếu mất Internet: đọc giờ từ RTC DS3231 vào hệ thống."""
    try:
        subprocess.run(["sudo", "hwclock", "-s"],  # Đọc RTC vào system clock
                       timeout=5, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[NET] System clock set from RTC: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    except Exception as e:
        print(f"[NET] RTC read error: {e}")


# ── WiFi Connect ──────────────────────────────────────────

def connect_wifi(ssid: str, password: str, request_id: str, r):
    """Kết nối vào WiFi nhà (uplink)."""
    cmd = (f"sudo nmcli dev wifi connect '{ssid}' password '{password}'"
           if password else f"sudo nmcli dev wifi connect '{ssid}'")
    try:
        subprocess.run(cmd, shell=True, check=True, timeout=45,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        result = {"status": "success", "ssid": ssid}
        print(f"[NET] Connected to WiFi: {ssid}")
    except Exception as e:
        result = {"status": "failed", "error": str(e)}
        print(f"[NET] WiFi connect failed: {e}")
    finally:
        if request_id:
            r.setex(f"wifi_cmd:{request_id}", 60, json.dumps(result))
        # Khởi động lại Hotspot sau khi kết nối uplink
        threading.Thread(target=ensure_hotspot, daemon=True).start()


# ── WiFi Scan ─────────────────────────────────────────────

def scan_wifi(r):
    """Quét mạng WiFi xung quanh."""
    try:
        subprocess.run("sudo nmcli dev wifi rescan",
                       shell=True, timeout=10,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(3)
        output = subprocess.check_output(
            "nmcli -t -f SSID,SIGNAL dev wifi list", shell=True
        ).decode()
        networks = []
        seen = set()
        for line in output.strip().split("\n"):
            parts = line.split(":")
            if len(parts) >= 2 and parts[0] and parts[0] not in seen:
                seen.add(parts[0])
                networks.append({"ssid": parts[0], "signal": int(parts[1]) if parts[1].isdigit() else 0})
        networks.sort(key=lambda x: -x["signal"])

        r.setex("wifi_scan_result", 300, json.dumps(networks))
        r.set("wifi_scan_status", "done")
        # Push lên Web
        r.publish("realtime_data", json.dumps({
            "event":    "wifi_scan_done",
            "networks": networks
        }))
        print(f"[NET] WiFi scan done: {len(networks)} networks")
    except Exception as e:
        r.set("wifi_scan_status", "error")
        print(f"[NET] WiFi scan error: {e}")


# ── Main loop ─────────────────────────────────────────────

def run():
    r            = get_redis()
    last_check   = 0
    last_ntp     = 0
    has_internet = False

    # Lắng nghe lệnh WiFi từ Web
    def listen_wifi_commands():
        pub = r.pubsub()
        pub.subscribe("wifi_commands", "wifi_scan_trigger")
        for msg in pub.listen():
            if msg["type"] != "message": continue
            try:
                channel = msg["channel"]
                if channel == "wifi_scan_trigger":
                    r.set("wifi_scan_status", "scanning")
                    threading.Thread(target=scan_wifi, args=(r,), daemon=True).start()
                elif channel == "wifi_commands":
                    data = json.loads(msg["data"])
                    threading.Thread(
                        target=connect_wifi,
                        args=(data.get("ssid"), data.get("password", ""),
                              data.get("request_id"), r),
                        daemon=True
                    ).start()
            except Exception as e:
                print(f"[NET] wifi command error: {e}")

    threading.Thread(target=listen_wifi_commands, daemon=True).start()

    # Đọc RTC lúc khởi động (trước khi có Internet)
    read_rtc_to_system()

    # Đảm bảo Hotspot active
    ensure_hotspot()
    print("[NET] Network watchdog started")

    while True:
        now = time.time()
        if (now - last_check) >= CHECK_EVERY:
            last_check = now

            status = get_wifi_status()
            r.setex("system_status:wifi", 120, json.dumps(status))

            new_internet = check_internet()
            if new_internet != has_internet:
                has_internet = new_internet
                event = "internet_online" if has_internet else "internet_offline"
                r.publish("realtime_data", json.dumps({
                    "event":   event,
                    "message": "Đã có Internet" if has_internet else "Mất kết nối Internet"
                }))
                print(f"[NET] Internet: {'ON' if has_internet else 'OFF'}")

            # Sync NTP → RTC mỗi giờ khi có Internet
            if has_internet and (now - last_ntp) >= 3600:
                sync_rtc_from_ntp()
                last_ntp = now

        time.sleep(5)


if __name__ == "__main__":
    run()
