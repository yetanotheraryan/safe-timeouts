# safe-timeouts

**Deadline-based timeouts for async Node.js code with AbortSignal support.**

![NPM Version](https://img.shields.io/npm/v/safe-timeouts)
![NPM Downloads](https://img.shields.io/npm/dw/safe-timeouts)
![GitHub package.json version](https://img.shields.io/github/package-json/v/yetanotheraryan/safe-timeouts?style=flat-square&color=blue)
![GitHub last commit](https://img.shields.io/github/last-commit/yetanotheraryan/safe-timeouts)
![GitHub contributors](https://img.shields.io/github/contributors/yetanotheraryan/safe-timeouts)
![GitHub forks](https://img.shields.io/github/forks/yetanotheraryan/safe-timeouts)
![GitHub Repo stars](https://img.shields.io/github/stars/yetanotheraryan/safe-timeouts)
![GitHub License](https://img.shields.io/github/license/yetanotheraryan/safe-timeouts)

Promise-based deadline enforcement for async code in Node.js. `safe-timeouts` helps you apply a **single execution deadline** across async functions, services, and external calls using standard `AbortSignal` semantics.

---


## Why this exists

In real backend systems, timeouts are **end-to-end**, not per-function:

* An HTTP request has a deadline
* That deadline must apply across DB calls, service logic, and external APIs
* Nested functions should **not accidentally extend** the available time

Most timeout utilities fail here because they:

* don’t propagate context
* don’t compose across nested calls
* don’t integrate with `AbortSignal`

`safe-timeouts` solves this correctly.

---

## Installation

```bash
npm install safe-timeouts
```

Node.js >= 16 is required.

---

## Basic usage

```ts
import { withTimeout, TimeoutError, safeAxios } from "safe-timeouts";
import axios from "axios";

try {
  const resultWithSafeAxios = await withTimeout(2000, async () => {
    const res = await safeAxios.get("https://api.example.com/users"); // no signal to be passed.
    return res.data;
  });

  const resultWithAxios = await withTimeout(2000, async (signal) => { // signal to be taken.
    const res = await axios.get("https://api.example.com/users", {signal}); // signal to be passed.
    return res.data;
  });

} catch (err) {
  if (err instanceof TimeoutError) {
    console.error("Request timed out");
  }
}
```

What happens:

* A 2s deadline is created
* An `AbortController` is started internally
* If the deadline is exceeded:

  * the promise rejects with `TimeoutError`
  * the `AbortSignal` is aborted
  * Axios cancels the HTTP request

---

## Nested timeouts (key feature)

Deadlines **propagate and compose automatically**.

```ts
await withTimeout(3000, async () => {
  await serviceA();          // uses part of the budget

  await withTimeout(5000, async () => {
    await serviceB();        // still limited by the original 3s
  });
});
```

The inner timeout **cannot extend** the outer deadline.

This makes time budgets safe and deterministic.

---

## safeAxios (optional helper but recommended)

`safeAxios` is a **convenience wrapper** around Axios that automatically integrates with safe-timeouts.

When used inside withTimeout, HTTP requests are automatically cancellable.
When used outside withTimeout, it behaves exactly like a normal Axios instance.

Example
```ts
import { withTimeout, safeAxios } from "safe-timeouts";

await withTimeout(2000, async () => {
  const res = await safeAxios.get("/users");
  return res.data;
});
```


### Custom Axios instance can also be created
```ts
import { withTimeout, createSafeAxios } from "safe-timeouts";

const api = createSafeAxios({
  baseURL: "https://api.example.com",
});

await withTimeout(1000, async () => {
  await api.post("/sync");
});
```

## How it works (context propagation)

safe-timeouts uses AsyncLocalStorage to propagate timeout context across async boundaries.

Example flow
```ts
await withTimeout(2000, async () => {
  await controller();
});

async function controller() {
  return serviceA();
}

async function serviceA() {
  return serviceB();
}

async function serviceB() {
  return safeAxios.get("/users");
}


Context flow diagram
withTimeout
  └─ Async context (deadline + AbortController)
       ├─ controller()
       │    └─ serviceA()
       │         └─ serviceB()
       │              └─ safeAxios.get()
       │                   └─ axios(request + signal)

```
The timeout context is created once
Node automatically propagates it across async calls
**safeAxios reads the context at request time When the deadline expires, the request is aborted**

---

## Using with services (multiple layers) without safeAxios

```ts
import axios from "axios";

await withTimeout(2000, async (signal) => {
  await controller(signal);
});

async function controller(signal) {
  await serviceA(signal);
}

async function serviceA(signal) {
  await serviceB(signal);
}

async function serviceB(signal) {
  const res = await axios.get("/users", { signal });
  return res.data;
}
```

All functions share the same deadline by passing the same `AbortSignal` down the call chain.

---

## Abort-aware vs non-abort-aware operations

### Abort-aware APIs (cancel immediately)

These stop execution as soon as the deadline is exceeded:

* `fetch` (Node 18+)
* `axios` (with `{ signal }`)
* `fs/promises` (partial)
* `stream.pipeline`
* `timers/promises`

Example:

```ts
    // GET
    await safeAxios.get(url); // 👈 No AbortSignal needed
    // POST
    await safeAxios.post(
      url,
      { name: "Aryan", role: "admin" },
      {
       // 👈 No AbortSignal goes here
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer YOUR_TOKEN",
        },
      })

    // GET
    await axios.get(url, { signal }); // 👈 AbortSignal goes here
    // POST
    await axios.post(
      url,
      { name: "Aryan", role: "admin" },
      {
        signal, // 👈 AbortSignal goes here
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer YOUR_TOKEN",
        },
      })

```

### Non-abort-aware operations (cooperative)

These **cannot be forcibly stopped**:

* `setTimeout` / sleep
* Sequelize queries
* CPU-bound loops
* legacy libraries

For these, `safe-timeouts`:

* stops waiting
* rejects the outer promise
* allows you to guard further logic

---

## Non-abort-aware operations and control flow

JavaScript cannot forcibly stop non-abort-aware operations (like `setTimeout`, Sequelize queries, or CPU-bound work).

When such operations exceed the deadline:

* `safe-timeouts` rejects the outer promise
* abort-aware APIs are cancelled automatically
* JavaScript execution resumes only when the pending operation completes

To keep control flow predictable:

* prefer calling abort-aware APIs (Axios, fetch, streams) after non-abort-aware work
* abort-aware APIs will throw immediately if the deadline has already been exceeded

This design avoids hidden global checks while remaining honest about JavaScript limitations.

---

## Axios integration

`safe-timeouts` works with Axios by passing the provided `AbortSignal` to the request.

```ts
import axios from "axios";
import { withTimeout } from "safe-timeouts";

await withTimeout(2000, async (signal) => {
  const res = await axios.get("/users", { signal });
  return res.data;
});
```

Axios is abort-aware:

* if the deadline is exceeded before the request starts, Axios throws immediately
* if the deadline is exceeded while the request is in flight, Axios cancels the request

This explicit integration keeps cancellation predictable and avoids hidden behavior.

---

## What `safe-timeouts` does NOT do

It is important to be explicit about limitations:

* ❌ It cannot forcibly stop JavaScript execution
* ❌ It cannot cancel non-abort-aware libraries
* ❌ It cannot stop CPU-bound loops
* ❌ It does not replace DB-level timeouts

This matches the realities of Node.js and modern async runtimes.

---

## How this differs from `setTimeout`

| Feature             | setTimeout | safe-timeouts |
| ------------------- | ---------- | ------------ |
| End-to-end deadline | ❌          | ✅            |
| Nested composition  | ❌          | ✅            |
| AbortSignal support | ❌          | ✅            |
| Context propagation | ❌          | ✅            |
| Concurrency-safe    | ❌          | ✅            |

`setTimeout` works locally. `safe-timeouts` works across your entire async call graph.

---

## API

### `withTimeout(ms, fn)`

Runs an async function with a deadline.

```ts
withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T>
```

Rejects with `TimeoutError` when the deadline is exceeded.

---

### `TimeoutError`

Error thrown when the deadline is exceeded.

```ts
instanceof TimeoutError === true
```

---

## When to use this

Use `safe-timeouts` when:

* you want request-level deadlines
* you call multiple async services
* you rely on Axios, fetch, or streams
* you want correct nested timeout behavior

Do **not** use it as a replacement for DB-level query timeouts.

---

## License

MIT
