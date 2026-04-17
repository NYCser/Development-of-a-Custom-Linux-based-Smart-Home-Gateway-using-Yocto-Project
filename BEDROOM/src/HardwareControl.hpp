#ifndef HARDWARE_CONTROL_HPP
#define HARDWARE_CONTROL_HPP

#include <Arduino.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Preferences.h>
#include <vector>
#include "Adafruit_CCS811.h"
#include "ClosedCube_HDC1080.h"
#include "Config.hpp"
#include "NetworkManager.hpp"

// ================= ĐỐI TƯỢNG PHẦN CỨNG =================
Adafruit_CCS811     ccs;
ClosedCube_HDC1080  hdc1080;
Preferences         preferences;

// Trạng thái thiết bị (volatile vì được đọc/ghi từ cả FreeRTOS task và main loop)
volatile bool fanState   = false;
volatile bool lightState = false;

// Cờ báo hiệu cho main loop sau khi nút bấm thay đổi
volatile bool fanChanged   = false;
volatile bool lightChanged = false;

// Giá trị cảm biến
float    valTemp = 0;
float    valHum  = 0;
uint16_t valCO2  = 0;
uint16_t valTVOC = 0;
bool     hasCCS  = false;

// Bộ đệm RAM lưu dữ liệu khi mất mạng (tối đa ~5 phút nếu gửi 5s/lần)
std::vector<String> sensorBuffer;
const size_t MAX_BUFFER_SIZE = 50;

// ================= HÀM HELPER =================

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
    preferences.begin("bedroom_state", false);
    preferences.putBool("fan",   fanState);
    preferences.putBool("light", lightState);
    preferences.end();
}

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

// ================= TASK NÚT NHẤN (FreeRTOS) =================

void taskButtonMonitor(void* parameter) {
    pinMode(PIN_BTN_FAN,   INPUT_PULLUP);
    pinMode(PIN_BTN_LIGHT, INPUT_PULLUP);

    int lastFanBtn   = HIGH;
    int lastLightBtn = HIGH;

    for (;;) {
        // Nút quạt
        int curFan = digitalRead(PIN_BTN_FAN);
        if (lastFanBtn == HIGH && curFan == LOW) {
            fanState = !fanState;
            digitalWrite(PIN_RELAY_FAN, fanState ? HIGH : LOW);
            fanChanged = true;
            Serial.println("[TASK] Fan Button Pressed!");
        }
        lastFanBtn = curFan;

        // Nút đèn
        int curLight = digitalRead(PIN_BTN_LIGHT);
        if (lastLightBtn == HIGH && curLight == LOW) {
            lightState = !lightState;
            digitalWrite(PIN_LIGHT, lightState ? HIGH : LOW);
            lightChanged = true;
            Serial.println("[TASK] Light Button Pressed!");
        }
        lastLightBtn = curLight;

        vTaskDelay(50 / portTICK_PERIOD_MS);
    }
}

// ================= SETUP =================

inline void setupHardware() {
    Serial.println("--- BEDROOM HARDWARE SETUP ---");

    // Khôi phục trạng thái từ Flash
    preferences.begin("bedroom_state", true);
    fanState   = preferences.getBool("fan",   false);
    lightState = preferences.getBool("light", false);
    preferences.end();

    // Output
    pinMode(PIN_RELAY_FAN, OUTPUT);
    pinMode(PIN_LIGHT,     OUTPUT);
    digitalWrite(PIN_RELAY_FAN, fanState   ? HIGH : LOW);
    digitalWrite(PIN_LIGHT,     lightState ? HIGH : LOW);

    // Khởi động FreeRTOS task nút nhấn
    xTaskCreate(taskButtonMonitor, "ButtonTask", 2048, NULL, 1, NULL);
    Serial.println(" Button Task Started");

    // Cảm biến I2C
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    hdc1080.begin(0x40);

    if (ccs.begin()) {
        hasCCS = true;
        while (!ccs.available());  // Chờ CCS811 warm-up
        Serial.println(" CCS811 Ready");
    } else {
        hasCCS = false;
        Serial.println(" CCS811 skipped");
    }

    Serial.println(" Hardware Ready");
}

// ================= LOOP HARDWARE =================

inline void loopHardware() {
    // A. Lưu Flash + gửi status khi nút bấm thay đổi
    if (fanChanged) {
        fanChanged = false;
        saveState();
        sendDeviceStatus(ID_FAN_BEDROOM, fanState);
    }
    if (lightChanged) {
        lightChanged = false;
        saveState();
        sendDeviceStatus(ID_LIGHT_BEDROOM, lightState);
    }

    // B. Gửi cảm biến mỗi 5 giây
    static unsigned long lastSensorSend = 0;
    if (millis() - lastSensorSend > 5000) {
        lastSensorSend = millis();

        float t = hdc1080.readTemperature();
        float h = hdc1080.readHumidity();

        if (hasCCS && ccs.available() && !ccs.readData()) {
            valCO2  = ccs.geteCO2();
            valTVOC = ccs.getTVOC();
            ccs.setEnvironmentalData(h, t);
        }

        StaticJsonDocument<256> doc;
        doc["temperature"] = isnan(t) ? 0 : t;
        doc["humidity"]    = isnan(h) ? 0 : h;
        doc["co2"]         = valCO2;
        doc["tvoc"]        = valTVOC;
        String out;
        serializeJson(doc, out);

        if (client.connected()) {
            if (!sensorBuffer.empty()) flushSensorBuffer();
            sendMQTT(TOPIC_SENSORS, out);
            Serial.printf("[DATA] Temp:%.1f Hum:%.1f CO2:%d TVOC:%d\n",
                          t, h, valCO2, valTVOC);
        } else {
            if (sensorBuffer.size() >= MAX_BUFFER_SIZE) {
                sensorBuffer.erase(sensorBuffer.begin());
                Serial.println("[OFFLINE] Buffer full, rotating...");
            }
            sensorBuffer.push_back(out);
            Serial.printf("[OFFLINE] Buffered. Size: %d/%d\n",
                          sensorBuffer.size(), MAX_BUFFER_SIZE);
        }
    }

    // C. Heartbeat trạng thái thiết bị mỗi 10 giây
    static unsigned long lastStatusSync = 0;
    if (millis() - lastStatusSync > 10000) {
        lastStatusSync = millis();
        if (client.connected()) {
            sendDeviceStatus(ID_FAN_BEDROOM,   fanState);
            sendDeviceStatus(ID_LIGHT_BEDROOM, lightState);
        }
    }
}

// ================= XỬ LÝ LỆNH TỪ GATEWAY =================

inline void processCommand(String topic, String payload) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, payload)) {
        Serial.println("[CMD] JSON parse error");
        return;
    }

    String action = doc["action"] | "";
    String device = doc["device"] | "";

    Serial.printf("[CMD] device=%s action=%s\n", device.c_str(), action.c_str());

    // --- OTA Update ---
    if (action == "ota_update") {
        String url = doc["url"] | "";
        if (url.length() == 0) {
            Serial.println("[OTA] Error: url is empty");
            return;
        }
        Serial.println("[OTA] Command received. URL: " + url);

        // Lưu trạng thái trước khi flash
        // setup() sẽ khôi phục từ Preferences sau khi reboot
        saveState();

        // Thực hiện OTA (blocking — reboot nếu thành công)
        performOTA(url);

        // Chỉ chạy đến đây nếu OTA thất bại
        Serial.println("[OTA] Failed. Resuming normal operation.");
        return;
    }

    // --- Điều khiển thiết bị ---
    bool state = (action == "turn_on");

    if (device == String(ID_FAN_BEDROOM)) {
        fanState = state;
        digitalWrite(PIN_RELAY_FAN, fanState ? HIGH : LOW);
        saveState();
        sendDeviceStatus(ID_FAN_BEDROOM, fanState);
        Serial.printf("[CMD] Fan -> %s\n", fanState ? "ON" : "OFF");
    }
    else if (device == String(ID_LIGHT_BEDROOM)) {
        lightState = state;
        digitalWrite(PIN_LIGHT, lightState ? HIGH : LOW);
        saveState();
        sendDeviceStatus(ID_LIGHT_BEDROOM, lightState);
        Serial.printf("[CMD] Light -> %s\n", lightState ? "ON" : "OFF");
    }
    else {
        Serial.printf("[CMD] Unknown device: %s\n", device.c_str());
    }
}

#endif
