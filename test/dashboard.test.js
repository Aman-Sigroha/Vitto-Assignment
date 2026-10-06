import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { registerHooks } from "node:module";
import { before, describe, it } from "node:test";
import { load as loadJsx } from "./jsx-loader.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Event = dom.window.Event;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});

registerHooks({ load: loadJsx });

const { createElement, useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AuthContext } = await import("../app/auth-provider.js");
const { LoanDashboard } = await import("../app/loan-dashboard.js");

const LOAN = {
  loan: {
    id: "42",
    principal: "200000.00",
    annualInterestRate: "18.0000",
    tenureMonths: 24,
    disbursementDate: "2024-01-15",
  },
  installments: [
    {
      installmentNo: 1,
      dueDate: "2024-02-15",
      principalDue: "6984.82",
      interestDue: "3000.00",
      totalDue: "9984.82",
      amountPaid: "0.00",
    },
  ],
  position: {
    outstandingPrincipal: "200000.00",
    nextDueDate: "2024-02-15",
    nextDueAmount: "9984.82",
    overdueAmount: "9984.82",
  },
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function signedOutAuth() {
  return {
    user: null,
    loading: false,
    configError: "",
    signIn: async () => {},
    signOut: async () => {},
  };
}

function Harness({ auth, request }) {
  return createElement(
    AuthContext.Provider,
    { value: auth },
    createElement(LoanDashboard, { loanId: "42", request }),
  );
}

async function render(node) {
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return root;
}

function setControl(element, value) {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(element, value);
  element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

describe("loan dashboard", () => {
  before(() => {
    document.body.replaceChildren();
  });

  it("shows the sign-in form when nobody is signed in", async () => {
    await render(createElement(Harness, { auth: signedOutAuth(), request: async () => {
      throw new Error("loan request should not run");
    } }));

    assert.equal(document.querySelector("h2").textContent, "Sign in");
    assert.ok(document.querySelector("input[type=email]"));
    assert.equal(document.querySelector("table"), null);
  });

  it("shows the seeded loan schedule and position after sign-in", async () => {
    const request = async (url) => {
      assert.equal(url, "/api/loans/42");
      return jsonResponse(200, LOAN);
    };
    await render(createElement(Harness, {
      auth: { ...signedOutAuth(), user: { uid: "user-1", email: "vitto-test@yourdomain.com" } },
      request,
    }));

    assert.match(document.body.textContent, /Signed in as vitto-test@yourdomain.com/);
    assert.match(document.body.textContent, /Outstanding principal/);
    assert.match(document.body.textContent, /200000\.00/);
    assert.match(document.body.textContent, /9984\.82/);
    assert.equal(document.querySelector(".overdue dd").textContent, "9984.82");
    assert.equal(document.querySelector("tbody tr").children[6].textContent, "9984.82");
  });

  it("posts a payment and loads the loan again", async () => {
    const calls = [];
    const refreshed = {
      ...LOAN,
      installments: [{ ...LOAN.installments[0], amountPaid: "5000.00" }],
      position: {
        ...LOAN.position,
        outstandingPrincipal: "198000.00",
        nextDueAmount: "4984.82",
        overdueAmount: "4984.82",
      },
    };
    const request = async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "POST") {
        const body = JSON.parse(options.body);
        assert.equal(body.amount, "5000.00");
        assert.equal(url, "/api/loans/42/payments");
        return jsonResponse(201, {
          payment: {
            duplicate: false,
            amount: "5000.00",
            paymentDate: body.paymentDate,
          },
        });
      }
      return jsonResponse(200, calls.length === 1 ? LOAN : refreshed);
    };

    await render(createElement(Harness, {
      auth: { ...signedOutAuth(), user: { uid: "user-1", email: "vitto-test@yourdomain.com" } },
      request,
    }));

    const keyBefore = document.querySelector("input[name=idempotencyKey]").value;
    await act(async () => {
      setControl(document.querySelector("input[name=amount]"), "5000.00");
    });
    await act(async () => {
      document.querySelector("form button[type=submit]").click();
    });

    assert.equal(calls.filter((call) => call.options.method === "POST").length, 1);
    assert.equal(JSON.parse(calls[1].options.body).idempotencyKey, keyBefore);
    assert.equal(calls.filter((call) => call.url === "/api/loans/42" && !call.options.method).length, 2);
    assert.match(document.body.textContent, /Recorded payment 5000\.00/);
    assert.match(document.body.textContent, /198000\.00/);
    assert.notEqual(document.querySelector("input[name=idempotencyKey]").value, keyBefore);
  });

  it("shows the API error message", async () => {
    const request = async () => jsonResponse(404, {
      error: { code: "LOAN_NOT_FOUND", message: "Loan not found." },
    });
    await render(createElement(Harness, {
      auth: { ...signedOutAuth(), user: { uid: "user-1", email: "vitto-test@yourdomain.com" } },
      request,
    }));

    assert.equal(document.querySelector("[role=alert]").textContent, "Loan not found.");
    assert.equal(document.querySelector("table"), null);
  });

  it("returns to the sign-in form when the API rejects the token", async () => {
    const auth = {
      ...signedOutAuth(),
      user: { uid: "user-1", email: "vitto-test@yourdomain.com" },
    };
    function Session() {
      const [current, setCurrent] = useState(auth);
      return createElement(Harness, {
        auth: {
          ...current,
          signOut: async () => setCurrent({ ...current, user: null }),
        },
        request: async () => jsonResponse(401, {
          error: {
            code: "UNAUTHENTICATED",
            message: "A valid Firebase ID token is required.",
          },
        }),
      });
    }

    await render(createElement(Session));
    assert.equal(document.querySelector("h2").textContent, "Sign in");
    assert.match(document.body.textContent, /A valid Firebase ID token is required/);
  });
});
