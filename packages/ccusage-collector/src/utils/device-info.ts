import { createHash } from "crypto";
import { hostname, networkInterfaces } from "os";
import type { DeviceIdentity } from "../types.js";

/**
 * Generate a unique device ID based on hostname and MAC address
 */
export function generateDeviceId(): string {
  const hostName = hostname();

  // Get MAC addresses from network interfaces
  const interfaces = networkInterfaces();
  const macAddresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (nets) {
      for (const net of nets) {
        // Filter out internal interfaces and get MAC addresses
        if (!net.internal && net.mac && net.mac !== "00:00:00:00:00:00") {
          macAddresses.push(net.mac);
        }
      }
    }
  }

  // Sort MAC addresses to ensure consistent ordering
  macAddresses.sort();

  // Create a hash from hostname and MAC addresses
  const deviceString = `${hostName}:${macAddresses.join(",")}`;
  const deviceId = createHash("sha256")
    .update(deviceString)
    .digest("hex")
    .substring(0, 32);

  return deviceId;
}

/**
 * Get device name (hostname)
 */
export function getDeviceName(): string {
  return hostname();
}

/** Resolve each device field independently without reading or writing config. */
export function resolveDeviceIdentity(
  device: Partial<DeviceIdentity> = {},
): DeviceIdentity {
  return {
    deviceId: device.deviceId ?? generateDeviceId(),
    deviceName: device.deviceName ?? getDeviceName(),
    displayName: device.displayName,
  };
}
