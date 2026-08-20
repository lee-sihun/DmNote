export const isMac = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform || '';
  const userAgent = navigator.userAgent || '';
  return /Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(userAgent);
};

export const isWindows = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform || '';
  const userAgent = navigator.userAgent || '';
  return /Win/i.test(platform) || /Windows/i.test(userAgent);
};
