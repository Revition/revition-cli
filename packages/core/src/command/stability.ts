/** Whether the experimental opt-in is present (T1.4.3: REVITION_EXPERIMENTAL=1 or --experimental). PURE. */
export function experimentalOptIn(env: Readonly<Record<string, string | undefined>>, flag: boolean): boolean {
  return flag || env['REVITION_EXPERIMENTAL'] === '1';
}
