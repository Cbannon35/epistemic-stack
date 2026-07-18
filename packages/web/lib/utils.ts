import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '')
}

/** Compact relative time for activity rows ("now", "5m ago", "2d ago"). */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) {
    return 'now'
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`
  }
  return `${Math.floor(seconds / 86_400)}d ago`
}
