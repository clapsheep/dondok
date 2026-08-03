export function hasFieldErrors(errors: object) {
  return Object.values(errors).some((message) => typeof message === 'string' && message.length > 0)
}
