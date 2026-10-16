import { customAlphabet } from "nanoid";
import { config } from "../config.js";

// Base62 without look-alikes (0/O, 1/l/I) so codes survive being read aloud or retyped.
const alphabet = "23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
const generate = customAlphabet(alphabet, config.codeLength);

export const newCode = () => generate();
export const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);

export const CODE_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

// Paths the server or dashboard owns. A custom back-half can never shadow these.
export const RESERVED_CODES = new Set([
  "api", "app", "assets", "docs", "login", "register", "signup", "logout", "settings", "admin",
  "dashboard", "links", "developers", "health", "static", "favicon.ico", "robots.txt", "index.html",
]);

export function isReserved(code: string) {
  return RESERVED_CODES.has(code.toLowerCase());
}
