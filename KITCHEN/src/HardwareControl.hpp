#ifndef HARDWARE_CONTROL_HPP
#define HARDWARE_CONTROL_HPP

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DHT.h>
#include <Adafruit_INA219.h>
#include <Preferences.h>
#include <vector>
#include "Config.hpp"
#include "NetworkManager.hpp"

// ================= ĐỐI TƯỢNG PHẦN CỨNG =================
LiquidCrystal_I2C lcd(LCD_ADDR, LCD_COLS, LCD_ROWS);
DHT dht(PIN_DHT, DHT11);
Adafruit_INA219 ina219;
Preferences preferences;

// Biến cảm biến
float valTemp    = 0;
float valHum     = 0;
int   valGas     = 0;
float valPowerMW = 0;
bool  isFire     = false;
bool  hasINA219  = false;

// Trạng thái thiết bị
bool fanState   = false;
bool lightState = false;

// Biến báo động
bool isAlarming      = false;
bool isMuted         = false;
unsigned long lastMuteTime = 0;
bool sentAlert       = false;

// Timers không chặn
unsigned long lastSafetyCheck  = 0;
unsigned long lastSensorSend   = 0;
unsigned long lastStatusSync   = 0;
unsigned long lastBuzzerToggle = 0;
bool buzzerState = false;

// Bộ đệm RAM lưu dữ liệu khi mất mạng (tối đa ~5 phút nếu gửi 5s/lần)
std::vector<String> sensorBuffer;
const size_t MAX_BUFFER_SIZE = 50;

// ================= HÀM HELPER =================

void controlBuzzer(bool on) {
#ifdef BUZZER_ACTIVE_LOW
    digitalWrite(PIN_BUZZER, on ? LOW : HIGH);
#else
    digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
#endif
}

void sendDeviceStatus(String docId, bool isOn) {
    if (client.connected()) {
        StaticJsonDocument<200> doc;
        doc["deviceId"] = docId;
        doc["isOn"]     = isOn;
        String out;
        serializeJson(doc, out);
        sendMQTT(TOPIC_STATUS, out);
    }
}

void saveState() {
    preferences.begin("kitchen_state", false);
    preferences.putBool("fan",   fanState);
    preferences.putBool("light", lightState);
    preferences.end();
}

void sendAlertOnce(String type, String msg) {
    if (client.connected()) {
        StaticJsonDocument<256> doc;
        doc["type"]    = type;
        doc["message"] = msg;
        String out;
        serializeJson(doc, out);
        sendMQTT(TOPIC_ALERT, out);
    }
}

// Xả bộ đệm khi có lại mạng
void flushSensorBuffer() {
    if (sensorBuffer.empty()) return;
    Serial.printf("[SYNC] Dang dong bo %d ban tin cu...\n", sensorBuffer.size());
    for (const String& payload : sensorBuffer) {
        sendMQTT(TOPIC_SENSORS, payload);
        delay(50);
    }
    sensorBuffer.clear();
    Serial.println("[SYNC] Da dong bo xong!");
}

// ================= SETUP =================

inline void setupHardware() {
    Serial.println("--- KITCHEN HARDWARE SETUP ---");

    // Khôi phục trạng thái thiết bị từ Flash
    preferences.begin("kitchen_state", true);
    fanState   = preferences.getBool("fan",   false);
    lightState = preferences.getBool("light", false);
    preferences.end();

    pinMode(PIN_RELAY_FAN, OUTPUT);
    pinMode(PIN_LIGHT,     OUTPUT);
    pinMode(PIN_BUZZER,    OUTPUT);
    controlBuzzer(false);

    digitalWrite(PIN_RELAY_FAN, fanState   ? HIGH : LOW);
    digitalWrite(PIN_LIGHT,     lightState ? HIGH : LOW);

    pinMode(PIN_GAS_MQ6,  INPUT);
    pinMode(PIN_FIRE_D0,  INPUT_PULLUP);

    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    dht.begin();
    lcd.init();
    lcd.backlight();

    if (!ina219.begin()) {
        Serial.println(" INA219 not found");
        hasINA219 = false;
    } else {
        hasINA219 = true;
    }

    lcd.setCursor(0, 0); lcd.print("SMART KITCHEN   ");
    lcd.setCursor(0, 1); lcd.print("System Ready    ");
    delay(2000);
    lcd.clear();
}

// ================= LOGIC AN TOÀN (100ms) =================

void checkSafety() {
    valGas  = analogRead(PIN_GAS_MQ6);
    isFire  = (digitalRead(PIN_FIRE_D0) == LOW);

    bool gasDetected = (valGas > GAS_THRESHOLD);
    bool danger      = (isFire || gasDetected);

    // Auto-unmute sau MUTE_TIMEOUT
    if (isMuted && (millis() - lastMuteTime > 10000)) {
        isMuted = false;
        Serial.println("[INFO] Auto Unmute (timeout)");
    }

    if (danger) {
        if (!isAlarming) Serial.println("[ALARM] SYSTEM TRIGGERED!");
        isAlarming = true;

        if (!sentAlert) {
            if (isFire)       Serial.println("[ALARM] FIRE DETECTED!");
            if (gasDetected)  Serial.printf("[ALARM] GAS LEAK! Level: %d > %d\n", valGas, GAS_THRESHOLD);

            String msg  = isFire ? "CHAY TAI BEP!"  : "RO RI KHI GAS!";
            String type = isFire ? "fire"            : "gas";
            sendAlertOnce(type, msg);
            sentAlert = true;

            // Tự bật quạt thoát khí khi có gas
            if (gasDetected && !fanState) {
                Serial.println("[AUTO] Turning on Fan for safety!");
                fanState = true;
                digitalWrite(PIN_RELAY_FAN, HIGH);
                saveState();
                sendDeviceStatus(ID_FAN_KITCHEN, true);
            }
        }

        // Còi nhấp nháy 200ms nếu chưa mute
        if (!isMuted) {
            if (millis() - lastBuzzerToggle > 200) {
                lastBuzzerToggle = millis();
                buzzerState = !buzzerState;
                controlBuzzer(buzzerState);
            }
        } else {
            controlBuzzer(false);
        }

        // LCD cảnh báo
        lcd.setCursor(0, 0);
        lcd.print(isFire ? "!! FIRE ALARM !!" : "!! GAS LEAK !!");
        lcd.setCursor(0, 1);
        lcd.print(isMuted ? " (MUTED)      " : "  EVACUATE!   ");

    } else {
        // Hết nguy hiểm
        if (isAlarming) {
            Serial.println("[SAFE] Alarm Cleared.");
            isAlarming = false;
            sentAlert  = false;
            isMuted    = false;
            controlBuzzer(false);
            lcd.clear();
            sendAlertOnce("system", "Nha bep da an toan.");
        }
    }
}

// ================= LOGIC MÔI TRƯỜNG (5000ms) =================

void handleEnvironment() {
    float t = dht.readTemperature();
    float h = dht.readHumidity();

    if (hasINA219) valPowerMW = ina219.getPower_mW();
    else           valPowerMW = 0;

    if (isnan(t)) t = 0;
    if (isnan(h)) h = 0;
    valTemp = t;
    valHum  = h;

    // Cập nhật LCD (chỉ khi không alarming)
    if (!isAlarming) {
        lcd.setCursor(0, 0);
        lcd.printf("T:%.0fC H:%.0f%% G:%d ", valTemp, valHum, valGas);
        lcd.setCursor(0, 1);
        lcd.printf("L:%s F:%s     ", lightState ? "ON" : "OF", fanState ? "ON" : "OF");
    }

    // Đóng gói JSON
    StaticJsonDocument<300> doc;
    doc["temperature"]  = valTemp;
    doc["humidity"]     = valHum;
    doc["gas"]          = valGas;
    doc["power"]        = valPowerMW;
    doc["fire_detected"] = isFire;
    String out;
    serializeJson(doc, out);

    // Gửi hoặc buffer tùy trạng thái mạng
    if (client.connected()) {
        if (!sensorBuffer.empty()) flushSensorBuffer();
        sendMQTT(TOPIC_SENSORS, out);
        Serial.printf("[DATA] Gas:%d Fire:%d Temp:%.1f Hum:%.1f\n",
                      valGas, isFire, valTemp, valHum);
    } else {
        // Mất mạng → lưu vào RAM buffer (xoay vòng nếu đầy)
        if (sensorBuffer.size() >= MAX_BUFFER_SIZE) {
            sensorBuffer.erase(sensorBuffer.begin());
            Serial.println("[OFFLINE] Buffer full, rotating...");
        }
        sensorBuffer.push_back(out);
        Serial.printf("[OFFLINE] Buffered. Size: %d/%d\n",
                      sensorBuffer.size(), MAX_BUFFER_SIZE);
    }
}

// ================= MAIN LOOP HARDWARE =================

inline void loopHardware() {
    // Kiểm tra an toàn mỗi 100ms
    if (millis() - lastSafetyCheck > 100) {
        lastSafetyCheck = millis();
        checkSafety();
    }

    // Đọc & gửi cảm biến mỗi 5 giây
    if (millis() - lastSensorSend > 5000) {
        lastSensorSend = millis();
        handleEnvironment();
    }

    // Sync trạng thái thiết bị mỗi 10 giây
    if (millis() - lastStatusSync > 10000) {
        lastStatusSync = millis();
        if (client.connected()) {
            sendDeviceStatus(ID_FAN_KITCHEN,   fanState);
            sendDeviceStatus(ID_LIGHT_KITCHEN, lightState);
        }
    }
}

// ================= XỬ LÝ LỆNH TỪ GATEWAY =================

inline void processCommand(String topic, String payload) {
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, payload);
    if (error) {
        Serial.println("[CMD] JSON parse error");
        return;
    }

    String device = doc["device"] | "";
    String action = doc["action"] | "";

    Serial.printf("[CMD] device=%s action=%s\n", device.c_str(), action.c_str());

    // --- Mute còi báo động ---
    if (action == "mute_alarm") {
        isMuted      = true;
        lastMuteTime = millis();
        Serial.println("[CMD] ALARM MUTED by User");
        return;
    }

    // --- Unmute từ Gateway (sau khi safety watchdog tự reset) ---
    if (action == "unmute") {
        isMuted = false;
        Serial.println("[CMD] UNMUTE received");
        return;
    }

    // --- OTA Update ---
    if (action == "ota_update") {
        String url = doc["url"] | "";
        if (url.length() == 0) {
            Serial.println("[OTA] Error: url is empty");
            return;
        }
        Serial.println("[OTA] Command received. URL: " + url);

        // Dừng còi trước khi OTA
        controlBuzzer(false);

        // Lưu trạng thái trước khi flash
        // (ESP32 sẽ tự reboot, setup() sẽ khôi phục từ Preferences)
        saveState();

        // Thực hiện OTA (blocking, ESP32 reboot nếu thành công)
        performOTA(url);

        // Chỉ chạy đến đây nếu OTA thất bại
        Serial.println("[OTA] Failed. Resuming normal operation.");
        return;
    }

    // --- Điều khiển thiết bị ---
    bool state = (action == "turn_on");

    if (device == ID_FAN_KITCHEN) {
        fanState = state;
        digitalWrite(PIN_RELAY_FAN, fanState ? HIGH : LOW);
        saveState();
        sendDeviceStatus(ID_FAN_KITCHEN, fanState);
        Serial.printf("[CMD] Fan -> %s\n", fanState ? "ON" : "OFF");
    }
    else if (device == ID_LIGHT_KITCHEN) {
        lightState = state;
        digitalWrite(PIN_LIGHT, lightState ? HIGH : LOW);
        saveState();
        sendDeviceStatus(ID_LIGHT_KITCHEN, lightState);
        Serial.printf("[CMD] Light -> %s\n", lightState ? "ON" : "OFF");
    }
    else {
        Serial.printf("[CMD] Unknown device: %s\n", device.c_str());
    }
}

#endif
