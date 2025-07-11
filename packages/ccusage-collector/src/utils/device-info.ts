import { createHash } from 'crypto'
import { hostname, networkInterfaces } from 'os'
import type { DeviceInfo } from '../types.js'
import { ConfigManager } from '../config.js'

/**
 * Generate a unique device ID based on hostname and MAC address
 */
export function generateDeviceId(): string {
  const hostName = hostname()
  
  // Get MAC addresses from network interfaces
  const interfaces = networkInterfaces()
  const macAddresses: string[] = []
  
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name]
    if (nets) {
      for (const net of nets) {
        // Filter out internal interfaces and get MAC addresses
        if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
          macAddresses.push(net.mac)
        }
      }
    }
  }
  
  // Sort MAC addresses to ensure consistent ordering
  macAddresses.sort()
  
  // Create a hash from hostname and MAC addresses
  const deviceString = `${hostName}:${macAddresses.join(',')}`
  const deviceId = createHash('sha256').update(deviceString).digest('hex').substring(0, 32)
  
  return deviceId
}

/**
 * Get device name (hostname)
 */
export function getDeviceName(): string {
  return hostname()
}

/**
 * Get complete device information
 * Priority: config file > generate new
 */
export function getDeviceInfo(): DeviceInfo {
  const configManager = new ConfigManager()
  const config = configManager.loadConfig()
  
  // If device info exists in config, use it
  if (config?.deviceId && config?.deviceName) {
    return {
      deviceId: config.deviceId,
      deviceName: config.deviceName
    }
  }
  
  // Generate new device info and save to config if possible
  const deviceId = generateDeviceId()
  const deviceName = getDeviceName()
  
  // Try to save to config if config exists
  if (config) {
    try {
      configManager.updateDeviceInfo(deviceId, deviceName)
      console.log(`📱 Generated and saved device info: ${deviceName} (${deviceId})`)
    } catch (error) {
      console.warn('⚠️  Could not save device info to config:', error instanceof Error ? error.message : error)
    }
  }
  
  return {
    deviceId,
    deviceName
  }
}