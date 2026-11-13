/*
  Plant Maintenance — example ESP32 reading.

  Posts one number to the same Apps Script web app the phones use.
  Put your own plant code in PLANT_CODE. Do not commit the real code,
  and do not print it. The script checks it and does not store it on the reading.

  Board: ESP32. Library: WiFi (built in) plus HTTPClient and WiFiClientSecure.
  Wiring for this example is a single analog pressure sensor on GPIO 34.
  Change SENSOR_TYPE, SENSOR_NAME, and the scale to match the instrument.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

const char* WIFI_SSID = "YOUR-WIFI";
const char* WIFI_PASSWORD = "YOUR-WIFI-PASSWORD";

// The web app URL that ends in /exec. Same one pasted into index.html.
const char* SCRIPT_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";

// The plant code from Code.gs. Keep this on the device only.
const char* PLANT_CODE = "PUT-YOUR-PLANT-CODE-HERE";

const char* ASSET_TAG = "AC-2";
const char* SENSOR_NAME = "Discharge pressure";
const char* SENSOR_TYPE = "pressure";  // pressure, temp, dewpoint, drain, hours, meter, other
const int SENSOR_PIN = 34;

void setup() {
  Serial.begin(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(400);
}

float readValue() {
  // Example scale: 0–3.3 V on the pin maps to 0–150 psi. Replace with your sensor.
  int raw = analogRead(SENSOR_PIN);
  return (raw / 4095.0f) * 150.0f;
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure client;
    client.setInsecure(); // The script certificate is Google's. Pin it if you prefer.
    HTTPClient http;
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    if (http.begin(client, SCRIPT_URL)) {
      http.addHeader("Content-Type", "text/plain");
      float value = readValue();
      String body = String("{\"action\":\"sensor\",\"code\":\"") + PLANT_CODE +
        "\",\"tag\":\"" + ASSET_TAG +
        "\",\"name\":\"" + SENSOR_NAME +
        "\",\"type\":\"" + SENSOR_TYPE +
        "\",\"value\":" + String(value, 1) +
        ",\"source\":\"esp32\"}";
      int status = http.POST(body);
      Serial.printf("sensor POST %d\n", status);
      http.end();
    }
  }
  delay(60000);
}
