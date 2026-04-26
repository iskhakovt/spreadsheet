import { type DeepMockProxy, mockDeep } from "vitest-mock-extended";

/**
 * Strict deep mock — every method on T is a vitest mock function whose default
 * behavior is to throw. Stub the methods the test exercises with
 * `mock.foo.mockResolvedValue(...)` etc.; any unstubbed call surfaces drift
 * between the test and the function-under-test instead of silently returning
 * undefined.
 */
export function strictMock<T>(): DeepMockProxy<T> {
  return mockDeep<T>({
    fallbackMockImplementation: () => {
      throw new Error("strictMock: unmocked method called");
    },
  });
}
