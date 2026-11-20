import en from './en.json' with { type: 'json' };

/**
 * D10 / plan section 8 invariant 9: product display names live ONLY in `en.json`; code reads them from here, so a later
 * display brand is a one-string change (a lint test refuses the display strings anywhere else in package sources).
 */
export type StringKey = keyof typeof en;

export function uiString(key: StringKey): string {
  return en[key];
}
