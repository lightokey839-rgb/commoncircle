// Mirrors the contract's `is_plain_text` (interface 1.1.1, D-009): text that
// appears on cards and in wallets may not contain control characters (Rust
// `char::is_control`, Unicode Cc) or invisible / direction-changing format
// characters that could spoof another circle's name.
const HIDDEN_OR_CONTROL = /[\u0000-\u001F\u007F-\u009F؜​-‏‪-‮⁠-⁩﻿]/u

export function isPlainText(text: string): boolean {
  return !HIDDEN_OR_CONTROL.test(text)
}

/** Throws the same rule the contract applies to `create_circle(name)`. */
export function assertCircleName(name: string): void {
  if (!name) throw new Error('Circle name is required.')
  if (name.trim() !== name) throw new Error('The circle name cannot start or end with spaces.')
  if (!isPlainText(name)) throw new Error('The circle name contains hidden or direction-changing characters. Retype it as plain text.')
}

/** Tagline rule from `themes.rs`: at most 32 characters, plain text. */
export function assertTagline(tagline: string): void {
  if ([...tagline].length > 32) throw new Error('The tagline must be 32 characters or fewer.')
  if (!isPlainText(tagline)) throw new Error('The tagline contains hidden or direction-changing characters. Retype it as plain text.')
}
