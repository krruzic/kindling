// Family detection and profiles from real-world Gamepad ids (Chromium and Firefox formats).
import { buttonFace, cleanPadName, detectFamily, keyLabel, profileFor, vendorProduct } from "../src/index.ts";
import { eq, test } from "./assert.ts";

const CASES: [string, string, string][] = [
  ["Xbox 360 Controller (XInput STANDARD GAMEPAD)", "standard", "xbox"],
  ["Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)", "standard", "xbox"],
  ["045e-028e-Microsoft X-Box 360 pad", "standard", "xbox"],
  ["Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)", "standard", "playstation"],
  ["DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", "standard", "playstation"],
  ["054c-0ce6-Sony Interactive Entertainment DualSense Wireless Controller", "standard", "playstation"],
  ["Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)", "standard", "switch"],
  ["057e-2009-Pro Controller", "", "switch"],
  ["Nintendo Switch Pro Controller", "standard", "switch"],
  ["Core Plus Wired Controller (STANDARD GAMEPAD Vendor: 20d6 Product: a711)", "standard", "switch"],
  ["MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1844)", "", "gc"],
  ["0079-1844-mayflash limited MAYFLASH GameCube Controller Adapter", "", "gc"],
  ["Nintendo Wii U GameCube Adapter Port 2 (Vendor: 057e Product: 0337)", "", "gc"],
  ["NSO GameCube Controller (Vendor: 057e Product: 2073)", "", "gc"],
  ["8BitDo Pro 2 (STANDARD GAMEPAD Vendor: 2dc8 Product: 6006)", "standard", "xbox"],
  ["Logitech Dual Action (Vendor: 046d Product: c216)", "", "generic"],
  ["Generic   USB  Joystick   (Vendor: 0079 Product: 0006)", "", "generic"],
];

test("families: detection from real-world ids", () => {
  for (const [id, mapping, want] of CASES) eq(detectFamily(id, mapping), want, id);
});

test("families: vendor / product parsing", () => {
  eq(vendorProduct("Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)"), {
    vendor: "054c",
    product: "09cc",
  });
  eq(vendorProduct("45e-28e-Xbox 360 Wired Controller"), { vendor: "045e", product: "028e" });
  eq(vendorProduct("Xbox 360 Controller (XInput STANDARD GAMEPAD)"), null);
});

test("families: odd-device profiles", () => {
  eq(
    profileFor({ id: "MAYFLASH GameCube Controller Adapter (Vendor: 0079 Product: 1844)", mapping: "" }).id,
    "mayflash_gc",
  );
  eq(profileFor({ id: "Nintendo Wii U GameCube Adapter Port 1", mapping: "" }).id, "gc_adapter_uinput");
  // A uinput pad the browser already maps to standard reads with the standard layout, not the Mayflash one.
  eq(profileFor({ id: "Nintendo Wii U GameCube Adapter Port 1", mapping: "standard" }).id, "standard");
  eq(profileFor({ id: "Switch 2 BT GC", mapping: "" }).id, "switch2_bt_gc");
  eq(profileFor({ id: "Pro Controller (Vendor: 057e Product: 2069)", mapping: "" }).id, "switch2_usb_pro");
  // (the NSO GameCube pad on raw USB: its own layout, not the Mayflash adapter's its name would match)
  const nso = profileFor({ id: "Nintendo Nintendo GameCube Controller (Vendor: 057e Product: 2073)", mapping: "" });
  eq(nso.id, "switch2_usb_gc");
  eq(nso.stick.y.invert, true);
  eq(String(nso.buttons.south), "1");
  eq(String(nso.buttons.west), "0");
  eq(profileFor({ id: "057e-2073-Nintendo GameCube Controller", mapping: "" }).id, "switch2_usb_gc");
  eq(profileFor({ id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", mapping: "standard" }).id, "standard");
});

test("families: labels, colours and shapes", () => {
  eq(buttonFace("xbox", "south").label, "A");
  eq(buttonFace("switch", "east").label, "A");
  eq(buttonFace("gc", "south").label, "A");
  eq(buttonFace("gc", "rb").label, "Z");
  eq(buttonFace("playstation", "south"), { label: "CROSS", color: "#6c8fd9", shape: "cross" });
  eq(keyLabel("KeyJ"), "J");
  eq(keyLabel("ArrowUp"), "UP");
  eq(keyLabel("Digit3"), "3");
  eq(keyLabel("Mouse0"), "LMB");
  eq(cleanPadName("Xbox 360 Controller (XInput STANDARD GAMEPAD)"), "XBOX 360 CONTROLLER");
  eq(cleanPadName("054c-0ce6-Sony DualSense"), "SONY DUALSENSE");
});
