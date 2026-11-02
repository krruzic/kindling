// Browser-only device readers (WebHID / WebUSB), each a PadProvider for InputManager. Importable anywhere: they
// only touch navigator.hid / navigator.usb when constructed, and do nothing where those don't exist.
export * from "./gcadapter.ts";
export * from "./procon2.ts";
export * from "./procon2wake.ts";
export type * from "./webhid.ts";
export { webHid, webUsb } from "./webhid.ts";
