# Persisted Operation State Transitions

**Retryable Persisted Operations** — Recover failures atomically without duplicating external side effects.

> Pattern: Model each persisted asynchronous operation as an explicit state machine. On a recoverable failure, atomically transition the same request from `failed` back to `pending`; if persistence fails after external work, transition its pending operation to `failed` before returning an error. Preserve the persisted operation identity across the client, HTTP boundary, and retry path.
> Avoid: Leaving requests permanently `pending`, recreating requests or parent conversations on retry, or invoking external/model work more than once for the same request ID.
