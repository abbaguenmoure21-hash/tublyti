export { cn } from "cn"

/** Escape LIKE/ILIKE wildcards (% and _) in user input */
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, '\\$&');
}
