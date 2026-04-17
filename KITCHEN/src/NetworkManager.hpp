#ifndef NETWORK_MANAGER_HPP
#define NETWORK_MANAGER_HPP

#include <WiFi.h>
#include <PubSubClient.h>
#include <HTTPUpdate.h>
#include "Config.hpp"

WiFiClient espClient;
PubSubClient client(espClient);

typedef void (*MsgCallback)(char*, uint8_t*, unsigned int);

unsigned long lastReconnectAttempt = 0;

// ================= SETUP NETWORK =================

void setupNetwork(MsgCallback callback) {
    Serial.println("\n--- BAT DAU KET NOI (DIRECT HOTSPOT MODE) ---");

    WiFi.disconnect(true);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);

    // IP tĩnh để không chờ DHCP
    IPAddress local_IP(10, 42, 0, 52);
    IPAddress gateway(10, 42, 0, 1);
    IPAddress subnet(255, 255, 255, 0);

    if (!WiFi.config(local_IP, gateway, subnet)) {
        Serial.println("Loi cau hinh IP Tinh!");
    }

    Serial.print("Dang ket noi vao Hotspot: ");
    Serial.println(WIFI_SSID);

    if (String(WIFI_PASS) == "") {
        WiFi.begin(WIFI_SSID, NULL);
    } else {
        WiFi.begin(WIFI_SSID, WIFI_PASS);
    }

    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 40) {
        delay(500);
        Serial.print(".");
        retries++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n KET NOI WIFI THANH CONG!");
        Serial.print("IP ESP32: "); Serial.println(WiFi.localIP());
        Serial.print("Gateway:  "); Serial.println(WiFi.gatewayIP());
        Serial.print("Signal:   "); Serial.println(WiFi.RSSI());
    } else {
        Serial.print("\n THAT BAI. Status: ");
        Serial.println(WiFi.status());
    }

    client.setServer(MQTT_SERVER, MQTT_PORT);
    client.setCallback(callback);
    client.setSocketTimeout(15);
    client.setKeepAlive(15);
}

// ================= MAINTAIN CONNECTION =================

inline void maintainConnection() {
    if (!client.connected()) {
        long now = millis();
        if (now - lastReconnectAttempt > 5000) {
            lastReconnectAttempt = now;

            if (WiFi.status() != WL_CONNECTED) {
                Serial.println(" Mat Wifi. Dang ket noi lai...");
                if (String(WIFI_PASS) == "") WiFi.begin(WIFI_SSID, NULL);
                else WiFi.begin(WIFI_SSID, WIFI_PASS);
                return;
            }

            String clientId = String(DEVICE_NODE_ID) + "_" + String(random(0xffff), HEX);
            Serial.print(" Connecting to MQTT Broker (" + String(MQTT_SERVER) + ")... ");

            if (client.connect(clientId.c_str())) {
                Serial.println(" Broker Connected!");
                client.subscribe(TOPIC_CMD);
                Serial.println(" Subscribed: " + String(TOPIC_CMD));
            } else {
                Serial.print(" Failed, rc=");
                Serial.println(client.state());
            }
        }
    } else {
        client.loop();
    }
}

// ================= SEND MQTT =================

inline void sendMQTT(const char* topic, String jsonString) {
    if (client.connected()) {
        client.publish(topic, jsonString.c_str());
    }
}

// ================= OTA UPDATE =================

// Forward declare để dùng lcd trong hàm OTA
// (lcd được khai báo trong HardwareControl.hpp, include sau)
// Dùng extern để tránh lỗi circular include
extern LiquidCrystal_I2C lcd;

void performOTA(String url) {
    Serial.println("[OTA] Starting update from: " + url);
    Serial.println("[OTA] Disconnecting MQTT...");

    // Ngắt MQTT trước để giải phóng socket
    client.disconnect();
    delay(200);

    // Hiển thị LCD
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("OTA UPDATE...   ");
    lcd.setCursor(0, 1); lcd.print("Please wait...  ");

    // Callback tiến trình - cập nhật LCD theo %
    httpUpdate.onProgress([](int cur, int total) {
        if (total > 0) {
            int pct = (cur * 100) / total;
            Serial.printf("[OTA] Progress: %d%%\n", pct);
            lcd.setCursor(0, 1);
            lcd.printf("Progress: %3d%%  ", pct);
        }
    });

    httpUpdate.setLedPin(LED_BUILTIN, LOW);
    httpUpdate.rebootOnUpdate(true); // Tự reboot sau khi flash xong

    WiFiClient otaClient;
    t_httpUpdate_return ret = httpUpdate.update(otaClient, url);

    // Chỉ chạy đến đây nếu OTA thất bại (thành công thì ESP32 đã reboot)
    switch (ret) {
        case HTTP_UPDATE_FAILED:
            Serial.printf("[OTA] FAILED (%d): %s\n",
                httpUpdate.getLastError(),
                httpUpdate.getLastErrorString().c_str());
            lcd.clear();
            lcd.setCursor(0, 0); lcd.print("OTA FAILED!     ");
            lcd.setCursor(0, 1); lcd.printf("ERR: %d          ", httpUpdate.getLastError());
            delay(3000);
            lcd.clear();
            break;

        case HTTP_UPDATE_NO_UPDATES:
            Serial.println("[OTA] No update available.");
            lcd.clear();
            lcd.setCursor(0, 0); lcd.print("OTA: No update  ");
            delay(2000);
            lcd.clear();
            break;

        case HTTP_UPDATE_OK:
            // Không bao giờ chạy đến đây nếu rebootOnUpdate=true
            Serial.println("[OTA] OK!");
            break;
    }

    // Kết nối lại MQTT sau khi OTA thất bại
    Serial.println("[OTA] Reconnecting MQTT...");
    lastReconnectAttempt = 0;
}

#endif
