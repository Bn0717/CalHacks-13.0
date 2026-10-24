// Bluetooth on/off. macOS has no built-in command for it, so this calls the same IOBluetooth function the menu uses,
// through osascript's JavaScript mode (no helper program to build). Reading the state uses system_profiler instead,
// so a change is always checked by a different tool than the one that made it.

function shq(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}

/** The command that turns Bluetooth on or off. Built from a boolean only. */
export function bluetoothSetCommand(on: boolean): string {
  const js = `ObjC.import("IOBluetooth"); ObjC.bindFunction("IOBluetoothPreferenceSetControllerPowerState", ["void", ["int"]]); $.IOBluetoothPreferenceSetControllerPowerState(${on ? 1 : 0});`;
  return `osascript -l JavaScript -e ${shq(js)}`;
}

/** Read-only: the controller's state and the devices connected to it. */
export const BLUETOOTH_STATE_CHECK = "system_profiler SPBluetoothDataType -json";

export interface BluetoothState {
  /** null when the output couldn't be read. */
  on: boolean | null;
  /** Names of connected devices. */
  connected: string[];
  /** Connected keyboards, mice and trackpads: turning Bluetooth off would cut them off. */
  inputDevices: string[];
}

const INPUT_TYPES = /keyboard|mouse|trackpad|touchpad|pointer|gamepad|controller/i;

export function parseBluetooth(json: string): BluetoothState {
  try {
    const root = (JSON.parse(json) as { SPBluetoothDataType?: Record<string, unknown>[] }).SPBluetoothDataType?.[0];
    if (!root) return { on: null, connected: [], inputDevices: [] };
    const state = (root.controller_properties as Record<string, unknown> | undefined)?.controller_state;
    const on = state === "attrib_on" ? true : state === "attrib_off" ? false : null;
    const list = Array.isArray(root.device_connected) ? (root.device_connected as Record<string, Record<string, unknown>>[]) : [];
    const devices = list.flatMap((entry) => Object.entries(entry).map(([name, props]) => ({ name, type: String(props?.device_minorType ?? "") })));
    return { on, connected: devices.map((d) => d.name), inputDevices: devices.filter((d) => INPUT_TYPES.test(d.type)).map((d) => d.name) };
  } catch {
    return { on: null, connected: [], inputDevices: [] };
  }
}
