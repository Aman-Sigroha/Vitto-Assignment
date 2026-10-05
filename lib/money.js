// Money is integer paise (1 rupee = 100 paise). Two decimal places is the only
// stored scale. Rounding is half away from zero. PostgreSQL NUMERIC values stay
// strings so they are never coerced through JavaScript floating point.

export const MONEY_SCALE = 2;
const PAISE_PER_RUPEE = 100n;
const MAX_RUPEE_DIGITS = 12;
const MONEY_PATTERN = /^(\d{1,12})(?:\.(\d{1,2}))?$/;

export function divideRoundHalfUp(numerator, denominator) {
  if (typeof numerator !== "bigint" || typeof denominator !== "bigint") {
    throw new Error("divideRoundHalfUp expects BigInt values.");
  }
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero.");
  }

  const negative = (numerator < 0n) !== (denominator < 0n);
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = (absoluteNumerator + absoluteDenominator / 2n) / absoluteDenominator;
  return negative ? -quotient : quotient;
}

export function parseMoney(value) {
  if (typeof value !== "string") {
    throw new Error("Money amounts must be decimal strings, not JavaScript numbers.");
  }

  const match = MONEY_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error(
      `Money amounts must be zero or positive, with at most ${MAX_RUPEE_DIGITS} digits and ${MONEY_SCALE} decimal places.`,
    );
  }

  const rupees = BigInt(match[1]);
  const fractionDigits = (match[2] ?? "").padEnd(MONEY_SCALE, "0");
  return rupees * PAISE_PER_RUPEE + BigInt(fractionDigits);
}

export function formatMoney(paise) {
  if (typeof paise !== "bigint") {
    throw new Error("Money amounts must be BigInt paise.");
  }

  const negative = paise < 0n;
  const absolute = negative ? -paise : paise;
  const rupees = absolute / PAISE_PER_RUPEE;
  const fraction = (absolute % PAISE_PER_RUPEE).toString().padStart(MONEY_SCALE, "0");
  return `${negative ? "-" : ""}${rupees.toString()}.${fraction}`;
}

export function addMoney(left, right) {
  return formatMoney(parseMoney(left) + parseMoney(right));
}

export function subtractMoney(left, right) {
  return formatMoney(parseMoney(left) - parseMoney(right));
}

export function compareMoney(left, right) {
  const difference = parseMoney(left) - parseMoney(right);
  if (difference < 0n) return -1;
  if (difference > 0n) return 1;
  return 0;
}

// node-pg returns NUMERIC as a string. Keep that string on the decimal scale.
export function moneyFromNumeric(value) {
  if (typeof value !== "string") {
    throw new Error("Expected a PostgreSQL NUMERIC money value as a string.");
  }
  return formatMoney(parseMoney(value));
}

export function moneyToNumeric(value) {
  return formatMoney(parseMoney(value));
}
