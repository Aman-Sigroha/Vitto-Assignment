import { divideRoundHalfUp, formatMoney, parseMoney } from "../money.js";

// EMI = P × r × (1 + r)^n / ((1 + r)^n − 1), where r = annual rate / 12 / 100.
// The power is calculated at 20 decimal places with half-up rounding. The EMI
// is rounded to paise once. Installments 1..n-1 use that EMI. The final
// principal component is whatever balance remains, so the principal column
// sums to the original principal and the last installment holds the remainder.

const CALC_SCALE = 20n;
const CALC_FACTOR = 10n ** CALC_SCALE;
const RATE_SCALE = 4;
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);
const RATE_PATTERN = /^(\d{1,4})(?:\.(\d{1,4}))?$/;

export function buildRepaymentSchedule({
  principal,
  annualInterestRate,
  tenureMonths,
  disbursementDate,
}) {
  const principalPaise = parsePrincipal(principal);
  const annualRateUnits = parseAnnualInterestRate(annualInterestRate);
  const months = parseTenure(tenureMonths);
  const disbursement = parseDisbursementDate(disbursementDate);
  return generateSchedule(principalPaise, annualRateUnits, months, disbursement);
}

function parsePrincipal(value) {
  let paise;
  try {
    paise = parseMoney(value);
  } catch (error) {
    throw new Error(`Principal must be a positive amount with at most 2 decimal places. ${error.message}`);
  }
  if (paise <= 0n) {
    throw new Error("Principal must be a positive amount with at most 2 decimal places.");
  }
  return paise;
}

function parseAnnualInterestRate(value) {
  if (typeof value !== "string") {
    throw new Error("Annual interest rate must be a decimal string, not a JavaScript number.");
  }

  const match = RATE_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error("Annual interest rate must be zero or positive, with at most 4 decimal places.");
  }

  const whole = BigInt(match[1]);
  const fraction = (match[2] ?? "").padEnd(RATE_SCALE, "0");
  return whole * RATE_FACTOR + BigInt(fraction);
}

function parseTenure(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("Tenure must be a whole number of months greater than zero.");
  }
  return value;
}

function parseDisbursementDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Disbursement date must be a valid calendar date in YYYY-MM-DD form.");
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  const valid = utc.getUTCFullYear() === year
    && utc.getUTCMonth() === month - 1
    && utc.getUTCDate() === day;

  if (!valid) {
    throw new Error("Disbursement date must be a valid calendar date in YYYY-MM-DD form.");
  }

  return { year, month, day };
}

function addCalendarMonths({ year, month, day }, monthsToAdd) {
  const monthIndex = month - 1 + monthsToAdd;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonthIndex = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  const formattedMonth = String(targetMonthIndex + 1).padStart(2, "0");
  const formattedDay = String(targetDay).padStart(2, "0");
  return `${targetYear}-${formattedMonth}-${formattedDay}`;
}

function monthlyRateScaled(annualRateUnits) {
  if (annualRateUnits === 0n) return 0n;
  return divideRoundHalfUp(
    annualRateUnits * CALC_FACTOR,
    RATE_FACTOR * 100n * 12n,
  );
}

function powerScaled(base, exponent) {
  let result = CALC_FACTOR;
  for (let step = 0; step < exponent; step += 1) {
    result = divideRoundHalfUp(result * base, CALC_FACTOR);
  }
  return result;
}

function calculateEmiPaise(principalPaise, annualRateUnits, months) {
  if (annualRateUnits === 0n) {
    return divideRoundHalfUp(principalPaise, BigInt(months));
  }

  const rate = monthlyRateScaled(annualRateUnits);
  const compounded = powerScaled(CALC_FACTOR + rate, months);
  const principalScaled = (principalPaise * CALC_FACTOR) / 100n;
  const emiScaled = divideRoundHalfUp(
    divideRoundHalfUp(principalScaled * rate, CALC_FACTOR) * compounded,
    compounded - CALC_FACTOR,
  );
  return divideRoundHalfUp(emiScaled, CALC_FACTOR / 100n);
}

function generateSchedule(principalPaise, annualRateUnits, months, disbursement) {
  const emiPaise = calculateEmiPaise(principalPaise, annualRateUnits, months);
  const monthlyRate = monthlyRateScaled(annualRateUnits);
  let outstanding = principalPaise;
  const schedule = [];

  for (let installmentNo = 1; installmentNo <= months; installmentNo += 1) {
    const interestDue = monthlyRate === 0n
      ? 0n
      : divideRoundHalfUp(outstanding * monthlyRate, CALC_FACTOR);
    const isLast = installmentNo === months;
    const principalDue = isLast ? outstanding : emiPaise - interestDue;

    if (!isLast && principalDue < 0n) {
      throw new Error("Rounded EMI does not cover the interest due for this installment.");
    }

    outstanding -= principalDue;
    schedule.push({
      installmentNo,
      dueDate: addCalendarMonths(disbursement, installmentNo),
      principalDue: formatMoney(principalDue),
      interestDue: formatMoney(interestDue),
      totalDue: formatMoney(principalDue + interestDue),
      amountPaid: formatMoney(0n),
    });
  }

  if (outstanding !== 0n) {
    throw new Error("Schedule principal did not reconcile to the original principal.");
  }

  return schedule;
}
