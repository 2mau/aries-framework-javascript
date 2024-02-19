export function parseVersionString(version: VersionString): Version {
  const [major, minor, patch] = version.split('.')

  return [Number(major), Number(minor), Number(patch ?? '0')]
}

export function isFirstVersionHigherThanSecond(first: Version, second: Version) {
  return (
    first[0] > second[0] ||
    (first[0] === second[0] && first[1] > second[1]) ||
    (first[0] === second[0] && first[1] === second[1] && first[2] > second[2])
  )
}

export function isFirstVersionEqualToSecond(first: Version, second: Version) {
  return first[0] === second[0] && first[1] === second[1] && first[2] === second[2]
}

export function isFirstVersionHigherOrEqualToSecond(first: Version, second: Version) {
  return isFirstVersionHigherThanSecond(first, second) || isFirstVersionEqualToSecond(first, second)
}

/**
 * Checks if the first version is between the second and third versions.
 * @param first - The version to check.
 * @param second - The lower bound.
 * @param third - The upper bound (exclusive).
 * @returns True if the first version is between the second and third versions, false otherwise.
 */
export function isFirstVersionBetween(first: Version, second: Version, third: Version) {
  return isFirstVersionHigherOrEqualToSecond(first, second) && isFirstVersionHigherThanSecond(third, first)
}

export type VersionString = `${number}.${number}` | `${number}.${number}.${number}`
export type MajorVersion = number
export type MinorVersion = number
export type PatchVersion = number
export type Version = [MajorVersion, MinorVersion, PatchVersion]
