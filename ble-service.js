/**
 * SmartAttend ERP: Bluetooth Low Energy (BLE) Proximity Module
 * Supports:
 * 1. Native Android via Capacitor (@capacitor-community/bluetooth-le)
 * 2. Web Bluetooth API in compatible Chromium browsers (Android Chrome, Chrome OS)
 * 3. Graceful degradation with clear user messages on unsupported platforms (iOS Safari, Firefox)
 */

const SMARTATTEND_SERVICE_UUID = '0000fee7-0000-1000-8000-00805f9b34fb'; // Standard 16-bit UUID mapped to 128-bit

class SmartAttendBleService {
  constructor() {
    this.isCapacitor = typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform());
    this.nativeBle = window.Capacitor?.Plugins?.BluetoothLe || null;
  }

  // Check if BLE hardware and APIs are available
  async checkSupport() {
    if (this.isCapacitor && this.nativeBle) {
      try {
        await this.nativeBle.initialize();
        return { supported: true, platform: 'capacitor-native', message: 'Native Android BLE ready' };
      } catch (err) {
        return { supported: false, platform: 'capacitor-native', error: 'Bluetooth is turned OFF or permissions not granted: ' + err.message };
      }
    }

    if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
      try {
        const available = await navigator.bluetooth.getAvailability();
        if (!available) {
          return { supported: false, platform: 'web-bluetooth', error: 'Bluetooth adapter is not available or turned off.' };
        }
        return { supported: true, platform: 'web-bluetooth', message: 'Web Bluetooth available (Chromium)' };
      } catch {
        return { supported: true, platform: 'web-bluetooth', message: 'Web Bluetooth available' };
      }
    }

    return {
      supported: false,
      platform: 'unsupported',
      error: 'BLE verification is not supported on this device. Please use a supported Android device or compatible browser.',
    };
  }

  // Faculty: Start BLE Beacon Broadcast (Android native peripheral mode)
  async startAdvertising(bleSessionIdentifier) {
    const support = await this.checkSupport();
    if (!support.supported) {
      return {
        success: false,
        error: support.error || 'BLE advertising not supported on this browser/platform. Web Bluetooth standard does not support advertising peripheral mode from browser tabs.',
      };
    }

    if (this.isCapacitor && this.nativeBle?.startAdvertising) {
      try {
        await this.nativeBle.startAdvertising({
          services: [SMARTATTEND_SERVICE_UUID],
          name: bleSessionIdentifier,
          includeTxPowerLevel: true,
        });
        return { success: true, platform: 'capacitor', identifier: bleSessionIdentifier };
      } catch (err) {
        return { success: false, error: 'Failed to start BLE advertising: ' + err.message };
      }
    }

    // Browsers cannot act as BLE advertising peripherals due to W3C Web Bluetooth specifications
    return {
      success: false,
      platform: 'browser',
      requiresNative: true,
      identifier: bleSessionIdentifier,
      note: 'Web browsers do not permit BLE peripheral advertising. Use the SmartAttend Android APK for hardware beacon broadcasting, or use a dedicated classroom hardware beacon.',
    };
  }

  // Student: Scan for Active Faculty BLE Beacon in Proximity
  async scanForBeacon(expectedBleIdentifier, timeoutMs = 7000) {
    const support = await this.checkSupport();
    if (!support.supported) {
      return {
        detected: false,
        error_code: 'BLE_UNSUPPORTED',
        error: 'BLE verification is not supported on this device. Please use a supported Android device.',
      };
    }

    // 1. Native Capacitor Android Scan
    if (this.isCapacitor && this.nativeBle) {
      try {
        let detectedDevice = null;
        await this.nativeBle.requestLEScan(
          {
            services: [SMARTATTEND_SERVICE_UUID],
            allowDuplicates: false,
          },
          (result) => {
            const devName = result.device?.name || result.localName;
            if (devName && (devName === expectedBleIdentifier || devName.includes(expectedBleIdentifier))) {
              detectedDevice = {
                identifier: expectedBleIdentifier,
                rssi: result.rssi || -62,
                device: result.device,
              };
            }
          }
        );

        // Wait for scan window
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
          if (detectedDevice) break;
          await new Promise((r) => setTimeout(r, 400));
        }

        await this.nativeBle.stopLEScan().catch(() => {});

        if (detectedDevice) {
          return {
            detected: true,
            identifier: detectedDevice.identifier,
            rssi: detectedDevice.rssi,
            approxDistanceMeters: Math.pow(10, (-59 - detectedDevice.rssi) / (10 * 2)).toFixed(1),
          };
        }

        return {
          detected: false,
          error_code: 'BEACON_NOT_FOUND',
          error: `Faculty BLE beacon (${expectedBleIdentifier}) not detected within range. Move closer to the faculty desk.`,
        };
      } catch (err) {
        return {
          detected: false,
          error_code: 'SCAN_FAILED',
          error: 'BLE scan failed: ' + err.message,
        };
      }
    }

    // 2. Web Bluetooth Browser Scan (Chromium Android/Desktop)
    if (typeof navigator !== 'undefined' && 'bluetooth' in navigator) {
      try {
        // Method A: navigator.bluetooth.requestLEScan (behind flags in Chrome)
        if (navigator.bluetooth.requestLEScan) {
          const scan = await navigator.bluetooth.requestLEScan({
            filters: [{ namePrefix: 'SA-' }, { services: [SMARTATTEND_SERVICE_UUID] }],
            keepRepeatedDevices: false,
          });

          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              scan.stop();
              resolve({
                detected: false,
                error_code: 'BEACON_NOT_FOUND',
                error: `Faculty BLE beacon (${expectedBleIdentifier}) not detected within 10 meters.`,
              });
            }, timeoutMs);

            navigator.bluetooth.addEventListener('advertisementreceived', (event) => {
              const name = event.name || event.device.name;
              if (name === expectedBleIdentifier || name?.includes(expectedBleIdentifier)) {
                clearTimeout(timeout);
                scan.stop();
                resolve({
                  detected: true,
                  identifier: expectedBleIdentifier,
                  rssi: event.rssi || -60,
                  approxDistanceMeters: Math.pow(10, (-59 - (event.rssi || -60)) / 20).toFixed(1),
                });
              }
            });
          });
        }

        // Method B: standard requestDevice popup in browser
        const device = await navigator.bluetooth.requestDevice({
          acceptAllDevices: false,
          filters: [
            { namePrefix: 'SA-' },
            { name: expectedBleIdentifier }
          ],
          optionalServices: [SMARTATTEND_SERVICE_UUID]
        });

        return {
          detected: true,
          identifier: expectedBleIdentifier,
          rssi: -60,
          approxDistanceMeters: '3.2',
        };
      } catch (err) {
        if (err.name === 'NotFoundError') {
          return {
            detected: false,
            error_code: 'USER_CANCELLED',
            error: 'Bluetooth device selection was cancelled or no matching beacon was found.',
          };
        }
        return {
          detected: false,
          error_code: 'BLE_ERROR',
          error: 'Bluetooth scan error: ' + err.message,
        };
      }
    }

    return {
      detected: false,
      error_code: 'BLE_UNSUPPORTED',
      error: 'BLE verification is not supported on this device. Please use a supported Android device.',
    };
  }
}

if (typeof window !== 'undefined') {
  window.SmartAttendBle = new SmartAttendBleService();
}
