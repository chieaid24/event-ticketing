export interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
}

export function createDeferred<T>(): Deferred<T> {
  let rejectPromise: Deferred<T>["reject"] = () => undefined;
  let resolvePromise: Deferred<T>["resolve"] = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}
