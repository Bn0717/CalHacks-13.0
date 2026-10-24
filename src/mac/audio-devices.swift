// Lists sound output devices and switches the default one, using Apple's CoreAudio.
// Built once by src/mac/audio.ts with swiftc. Usage:
//   audio-devices list            → JSON: [{"id":73,"name":"MacBook Air Speakers","transport":"built-in","default":true}, ...]
//   audio-devices set <id>        → makes that device the default output (and the sound effects output)
import CoreAudio
import Foundation

func prop(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func allDevices() -> [AudioDeviceID] {
  var address = prop(kAudioHardwarePropertyDevices)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &ids) == noErr else { return [] }
  return ids
}

func hasOutput(_ id: AudioDeviceID) -> Bool {
  var address = prop(kAudioDevicePropertyStreams, kAudioDevicePropertyScopeOutput)
  var size: UInt32 = 0
  return AudioObjectGetPropertyDataSize(id, &address, 0, nil, &size) == noErr && size > 0
}

func name(_ id: AudioDeviceID) -> String {
  var address = prop(kAudioObjectPropertyName)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr, let v = value else { return "Unknown" }
  return v.takeRetainedValue() as String
}

func transport(_ id: AudioDeviceID) -> String {
  var address = prop(kAudioDevicePropertyTransportType)
  var value: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  guard AudioObjectGetPropertyData(id, &address, 0, nil, &size, &value) == noErr else { return "unknown" }
  switch value {
  case kAudioDeviceTransportTypeBuiltIn: return "built-in"
  case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
  case kAudioDeviceTransportTypeUSB: return "usb"
  case kAudioDeviceTransportTypeHDMI: return "hdmi"
  case kAudioDeviceTransportTypeDisplayPort: return "displayport"
  case kAudioDeviceTransportTypeAirPlay: return "airplay"
  case kAudioDeviceTransportTypeVirtual: return "virtual"
  case kAudioDeviceTransportTypeAggregate: return "aggregate"
  default: return "other"
  }
}

func defaultOutput() -> AudioDeviceID {
  var address = prop(kAudioHardwarePropertyDefaultOutputDevice)
  var id: AudioDeviceID = 0
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id)
  return id
}

func setDefault(_ selector: AudioObjectPropertySelector, _ id: AudioDeviceID) -> OSStatus {
  var address = prop(selector)
  var value = id
  return AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<AudioDeviceID>.size), &value)
}

func jsonString(_ s: String) -> String {
  let data = try! JSONSerialization.data(withJSONObject: [s], options: [])
  let wrapped = String(data: data, encoding: .utf8)!
  return String(wrapped.dropFirst().dropLast())
}

let args = CommandLine.arguments
if args.count >= 2 && args[1] == "list" {
  let current = defaultOutput()
  let items = allDevices().filter(hasOutput).map { id in
    "{\"id\":\(id),\"name\":\(jsonString(name(id))),\"transport\":\"\(transport(id))\",\"default\":\(id == current)}"
  }
  print("[" + items.joined(separator: ",") + "]")
} else if args.count >= 3 && args[1] == "set", let wanted = UInt32(args[2]) {
  guard allDevices().filter(hasOutput).contains(wanted) else {
    FileHandle.standardError.write("No sound output with that id.\n".data(using: .utf8)!)
    exit(2)
  }
  let a = setDefault(kAudioHardwarePropertyDefaultOutputDevice, wanted)
  _ = setDefault(kAudioHardwarePropertyDefaultSystemOutputDevice, wanted)
  if a != noErr {
    FileHandle.standardError.write("Couldn't switch the sound output (\(a)).\n".data(using: .utf8)!)
    exit(1)
  }
  print("ok")
} else {
  FileHandle.standardError.write("usage: audio-devices list | set <id>\n".data(using: .utf8)!)
  exit(64)
}
