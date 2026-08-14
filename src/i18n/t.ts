import i18n from './index'

/**
 * `t` for code that is not a component.
 *
 * The formatter modules — `workflowFormat`, `attendanceFormat`, `reportShared` — are plain functions
 * that turn a value into words. They cannot call `useTranslation`, and threading a `t` argument
 * through every one of them would change dozens of call sites to carry something none of them
 * otherwise care about.
 *
 * Reading the live instance is correct HERE and not a shortcut, for the same reason
 * `currentDirection()` is: these functions are called during the render of the component that shows
 * their result, and LanguageProvider remounts the whole routed tree on a switch. There is no cached
 * string left holding yesterday's language.
 *
 * INSIDE A COMPONENT, USE THE HOOK. `useTranslation()` subscribes, which is what makes a component
 * re-render if the language ever changes without a remount.
 */
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options)
}
