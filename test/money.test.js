import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMoney,
  compareMoney,
  divideRoundHalfUp,
  formatMoney,
  moneyFromNumeric,
  moneyToNumeric,
  parseMoney,
  subtractMoney,
} from "../lib/money.js";

describe("money", () => {
  it("keeps two-decimal amounts as integer paise", () => {
    assert.equal(parseMoney("200000.00"), 20000000n);
    assert.equal(parseMoney("10.5"), 1050n);
    assert.equal(formatMoney(998482n), "9984.82");
    assert.equal(addMoney("1.50", "2.25"), "3.75");
    assert.equal(subtractMoney("9986.00", "9984.82"), "1.18");
    assert.equal(compareMoney("1.18", "2.00"), -1);
  });

  it("rounds half up and away from zero", () => {
    assert.equal(divideRoundHalfUp(1n, 2n), 1n);
    assert.equal(divideRoundHalfUp(5n, 2n), 3n);
    assert.equal(divideRoundHalfUp(-1n, 2n), -1n);
    assert.equal(divideRoundHalfUp(10000n, 3n), 3333n);
  });

  it("converts PostgreSQL NUMERIC strings without using floating point", () => {
    assert.equal(moneyFromNumeric("9984.82"), "9984.82");
    assert.equal(moneyToNumeric("10.5"), "10.50");
    assert.equal(parseMoney("1.10"), 110n);
    assert.throws(() => moneyFromNumeric(9984.82), /NUMERIC/);
  });

  it("rejects non-numeric money, extra precision, and JavaScript numbers", () => {
    assert.throws(() => parseMoney("abc"), /2 decimal places/);
    assert.throws(() => parseMoney("-1.00"), /2 decimal places/);
    assert.throws(() => parseMoney("1.234"), /2 decimal places/);
    assert.throws(() => parseMoney(200000), /decimal strings/);
  });
});
