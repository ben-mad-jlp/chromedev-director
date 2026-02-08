/**
 * Utility functions for time formatting
 * Used by UI components to display timestamps and durations
 */

/**
 * Formats a date as relative time (e.g., "2 minutes ago", "just now")
 * @param date - Date object to format
 * @returns Relative time string
 */
export function relativeTime(date: Date): string {
  const now = Date.now();
  const timestamp = date.getTime();
  const diff = now - timestamp;

  if (diff < 60000) {
    return "just now";
  }

  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }

  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  const days = Math.floor(diff / 86400000);
  return `${days}d ago`;
}

/**
 * Formats a duration in milliseconds as a readable string (e.g., "1.23s", "45ms")
 * @param ms - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Formats a date as a full timestamp (e.g., "2026-02-07 22:45:30")
 * @param date - Date object to format
 * @returns Full timestamp string in YYYY-MM-DD HH:MM:SS format
 */
export function fullTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}
