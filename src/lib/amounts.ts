// TODO C5: an Amount box can print its amount with thousands commas and two
// decimals, "47752.9" as "47,752.90". It is a choice per box, off unless
// ticked (CLAUDE.md: amounts print exactly as typed unless parsing is added
// on purpose). Only what is printed changes, never what was typed or
// imported. Nothing is rounded: a value with more than two decimals, or that
// is not clearly one number, prints exactly as it is.

const PLAIN_AMOUNT = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const WITH_COMMAS = /^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/;

export function formatAmountWithCommas(value: string): string | null {
  const text = value.trim();
  // Commas are taken out only where they already stand as thousands commas.
  const plain = WITH_COMMAS.test(text) ? text.replace(/,/g, "") : text;
  const match = PLAIN_AMOUNT.exec(plain);
  if (!match) return null;
  const [, sign, whole, decimals = ""] = match;
  const digits = whole.replace(/^0+(?=\d)/, "");
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${decimals.padEnd(2, "0")}`;
}
