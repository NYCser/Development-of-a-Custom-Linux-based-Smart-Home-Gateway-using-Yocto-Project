#ifndef CONFIG_HPP
#define CONFIG_HPP

// ================= 1. CẤU HÌNH MẠNG (HOTSPOT NỘI BỘ) =================
// Tên Hotspot Raspberry Pi
#define WIFI_SSID "SmartHome_Hub" 
#define WIFI_PASS ""      

// IP Tĩnh của Raspberry Pi (Gateway mặc định của Hotspot Linux)
#define MQTT_SERVER "10.42.0.1"    
#define MQTT_PORT 1883

// ================= 2. ĐỊNH DANH NODE & PHÒNG =================
#define DEVICE_NODE_ID "esp32_bedroom_node"
#define ROOM_BEDROOM "bedroom_01"

// ID thiết bị (PHẢI KHỚP VỚI DATABASE FIREBASE)
#define ID_FAN_BEDROOM   "fan_bd_1"   
#define ID_LIGHT_BEDROOM "light_bd_1" 

// ================= 3. PIN MAP =================
// Output
#define PIN_RELAY_FAN 4
#define PIN_LIGHT     5

// Input Sensors (I2C)
#define PIN_I2C_SDA   21
#define PIN_I2C_SCL   22

// Input Buttons
#define PIN_BTN_FAN   12
#define PIN_BTN_LIGHT 13

// ================= 4. MQTT TOPICS =================
const char* TOPIC_CMD = "home/" ROOM_BEDROOM "/command";
const char* TOPIC_SENSORS = "home/" ROOM_BEDROOM "/sensors"; 
const char* TOPIC_STATUS  = "home/" ROOM_BEDROOM "/status";  

#endif