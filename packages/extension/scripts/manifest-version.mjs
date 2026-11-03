// Chrome accepts 1 to 4 dot-separated integers, each 0 to 65535, without
// leading zeros. Anything else (a pre-release suffix, say) is rejected when
// the extension loads, so the build refuses it first.
const part = /^(0|[1-9]\d*)$/;

export function checkVersion(version) {
  const parts = typeof version === 'string' ? version.split('.') : [];
  const valid =
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((p) => part.test(p) && Number(p) <= 65535);
  if (!valid) {
    throw new Error(
      `invalid extension version ${JSON.stringify(version)} in package.json: ` +
        'use 1 to 4 dot-separated integers (0-65535, no leading zeros, no suffix), e.g. 1.2.3',
    );
  }
  return version;
}
