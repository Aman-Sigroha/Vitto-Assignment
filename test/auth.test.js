import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POST as createLoanRoute } from "../app/api/loans/route.js";
import { GET as getLoanRoute } from "../app/api/loans/[id]/route.js";
import { POST as recordPaymentRoute } from "../app/api/loans/[id]/payments/route.js";
import { readBearerToken, requireRequestUser } from "../lib/auth.js";
import { normalizePrivateKey } from "../lib/firebase-admin.js";

const UNAUTHENTICATED = {
  error: {
    code: "UNAUTHENTICATED",
    message: "A valid Firebase ID token is required.",
  },
};

function requestWith(authorization) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("http://localhost/api/loans", { headers });
}

describe("authentication header", () => {
  it("turns an escaped private key into real line breaks without keeping the escape sequence", () => {
    const normalized = normalizePrivateKey("\"line-one\\nline-two\\n\"");
    assert.equal(normalized, "line-one\nline-two\n");
    assert.equal(normalized.includes("\\n"), false);
  });

  it("rejects a missing or malformed bearer token before Firebase is called", async () => {
    assert.equal(readBearerToken(requestWith()), null);
    assert.equal(readBearerToken(requestWith("")), null);
    assert.equal(readBearerToken(requestWith("Basic abc")), null);
    assert.equal(readBearerToken(requestWith("Bearer")), null);
    assert.equal(readBearerToken(requestWith("Bearer ")), null);
    assert.equal(readBearerToken(requestWith("Bearer not-a-jwt")), null);
    assert.equal(readBearerToken(requestWith("Bearer aaa.bbb.ccc extra")), null);

    for (const header of [undefined, "", "Basic abc", "Bearer", "Bearer not-a-jwt"]) {
      await assert.rejects(
        () => requireRequestUser(requestWith(header)),
        (error) => error.status === 401 && error.code === "UNAUTHENTICATED",
      );
    }
  });

  it("returns 401 from all three loan routes when no token is sent", async () => {
    const created = await createLoanRoute(new Request("http://localhost/api/loans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        principal: "200000.00",
        annualInterestRate: "18",
        tenureMonths: 24,
        disbursementDate: "2024-01-15",
      }),
    }));
    assert.equal(created.status, 401);
    assert.deepEqual(await created.json(), UNAUTHENTICATED);

    const loaded = await getLoanRoute(
      new Request("http://localhost/api/loans/1"),
      { params: Promise.resolve({ id: "1" }) },
    );
    assert.equal(loaded.status, 401);
    assert.deepEqual(await loaded.json(), UNAUTHENTICATED);

    const paid = await recordPaymentRoute(
      new Request("http://localhost/api/loans/1/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: "5000.00",
          paymentDate: "2024-03-05",
          idempotencyKey: "missing-token",
        }),
      }),
      { params: Promise.resolve({ id: "1" }) },
    );
    assert.equal(paid.status, 401);
    assert.deepEqual(await paid.json(), UNAUTHENTICATED);
  });
});
