#include <Arduino.h>
#include "Config.hpp"
#include "NetworkManager.hpp"
#include "HardwareControl.hpp"

// Callback khi nhận tin nhắn MQTT
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    String message;
    for (unsigned int i = 0; i < length; i++) {
        message += (char)payload[i];
    }
    processCommand(String(topic), message);
}

void setup() {
    Serial.begin(115200);
    delay(1000);

    // 1. Setup phần cứng (Sensors, Pins, LCD, khôi phục trạng thái)
    setupHardware();

    // 2. Setup mạng (WiFi + MQTT)
    setupNetwork(mqttCallback);

    Serial.println(">>> KITCHEN NODE READY <<<");
}

void loop() {
    // 1. Duy trì kết nối WiFi + MQTT (non-blocking)
    maintainConnection();

    // 2. Chạy logic cảm biến, an toàn, gửi dữ liệu
    loopHardware();
}
