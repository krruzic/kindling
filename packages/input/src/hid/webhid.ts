// Minimal WebHID / WebUSB shapes (not in TypeScript's DOM lib) and access to them, so the HID readers type-check
// and stay importable in node (where navigator.hid / navigator.usb are simply absent).

export interface HIDInputReportEventLike extends Event {
  reportId: number;
  data: DataView;
}

export interface HIDDeviceLike extends EventTarget {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName?: string;
  open(): Promise<void>;
  sendReport?(reportId: number, data: BufferSource): Promise<void>;
}

export interface HIDLike extends EventTarget {
  getDevices(): Promise<HIDDeviceLike[]>;
  requestDevice(opts: { filters: { vendorId: number; productId?: number }[] }): Promise<HIDDeviceLike[]>;
}

export function webHid(): HIDLike | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as unknown as { hid?: HIDLike }).hid;
}

export interface USBEndpointLike {
  endpointNumber: number;
  direction: "in" | "out";
  type: string;
}

export interface USBInterfaceLike {
  interfaceNumber: number;
  alternate: { interfaceClass: number; endpoints: USBEndpointLike[] };
}

export interface USBDeviceLike {
  vendorId: number;
  productId: number;
  opened: boolean;
  configuration: { interfaces: USBInterfaceLike[] } | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>;
  releaseInterface(n: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<unknown>;
  transferIn(ep: number, len: number): Promise<unknown>;
}

export interface USBLike extends EventTarget {
  getDevices(): Promise<USBDeviceLike[]>;
  requestDevice(opts: { filters: { vendorId: number; productId: number }[] }): Promise<USBDeviceLike>;
}

export function webUsb(): USBLike | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as unknown as { usb?: USBLike }).usb;
}
