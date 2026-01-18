import { timeoutContext } from "./context";
import { TimeoutError } from "./errors";

export async function withTimeout<T>(
    ms: number,
    fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
    const parent = timeoutContext.getStore();
    const now = Date.now();

    const deadline = parent
        ? Math.min(parent.deadline, now + ms)
        : now + ms;

    if (deadline <= now) {
        throw new TimeoutError();
    }

    const controller = new AbortController();
    const remaining = deadline - now;

    const timer = setTimeout(() => {
        controller.abort();
    }, remaining);

    try {
        return await timeoutContext.run(
            { deadline, controller },
            () =>
                Promise.race([
                    fn(controller.signal),
                    new Promise<never>((_, reject) => {
                        controller.signal.addEventListener(
                            "abort",
                            () => reject(new TimeoutError()),
                            { once: true }
                        );
                    }),
                ])
        );
    } finally {
        clearTimeout(timer);
    }
}