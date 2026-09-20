export const USERNAME_MIN = 3
export const USERNAME_MAX = 32

export function toUsernameSlug(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function isValidUsername(slug: string): boolean {
  return slug.length >= USERNAME_MIN && slug.length <= USERNAME_MAX
}

export function toAuthEmail(input: string, domain: string): string {
  return `${toUsernameSlug(input)}@${domain}`
}
