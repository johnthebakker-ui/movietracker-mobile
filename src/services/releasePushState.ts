export function acknowledgedLegacyReleaseKeys(
  releaseDates: Record<string, string>,
  presentedReleaseKeys: string[],
  today: string,
  afterDailyTrigger: boolean
) {
  const acknowledged = new Set(presentedReleaseKeys.filter(Boolean));
  Object.entries(releaseDates).forEach(([releaseKey, releaseDate]) => {
    if (releaseDate < today || (releaseDate === today && afterDailyTrigger)) acknowledged.add(releaseKey);
  });
  return [...acknowledged];
}
