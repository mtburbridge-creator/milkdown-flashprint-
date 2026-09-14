/// Delays a call until `waitMs` has passed with no new call. Each call
/// resets the timer, so only the last call in a burst runs.
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined

  return (...args: Args) => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      fn(...args)
    }, waitMs)
  }
}
