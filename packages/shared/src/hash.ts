/** FNV-1a hash → base36 string. Used for localStorage key scoping. */
export function fnv1a(input: string): string {
  let a = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    a ^= input.charCodeAt(i);
    a = (a * 0x01000193) | 0;
  }
  return (a >>> 0).toString(36);
}
