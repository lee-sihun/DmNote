/**
 * 플러그인 함수 래퍼
 * 플러그인 컨텍스트를 유지하면서 함수를 실행할 수 있도록 래핑합니다.
 */

/**
 * 함수를 플러그인 컨텍스트로 래핑합니다.
 * 비동기 함수의 경우 Promise가 완료될 때까지 컨텍스트를 유지합니다.
 */
export const wrapFunctionWithContext = (fn: any, pluginId: string) => {
  if (typeof fn !== 'function') return fn;
  if (fn.__dmn_plugin_wrapped__) return fn;

  const wrapped = function (this: any, ...args: any[]) {
    const prev = (window as any).__dmn_current_plugin_id;
    (window as any).__dmn_current_plugin_id = pluginId;
    let result: any;
    let threw = false;
    try {
      result = fn.apply(this, args);
    } catch (error) {
      threw = true;
      throw error;
    } finally {
      if (threw || !result || typeof result.then !== 'function') {
        (window as any).__dmn_current_plugin_id = prev;
      }
    }

    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        (window as any).__dmn_current_plugin_id = prev;
      });
    }

    return result;
  };

  try {
    Object.defineProperty(wrapped, 'name', {
      value: fn.name,
      configurable: true,
    });
  } catch {
    // noop
  }

  Object.defineProperty(wrapped, '__dmn_plugin_wrapped__', {
    value: true,
    configurable: false,
  });

  return wrapped;
};

/**
 * 객체/배열의 모든 함수를 재귀적으로 래핑합니다.
 */
export const wrapApiValue = (value: any, pluginId: string): any => {
  if (typeof value === 'function') {
    return wrapFunctionWithContext(value, pluginId);
  }

  if (value && typeof value === 'object') {
    const clone: any = Array.isArray(value) ? [] : {};
    Object.keys(value).forEach((key) => {
      clone[key] = wrapApiValue(value[key], pluginId);
    });
    return clone;
  }

  return value;
};
