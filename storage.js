// Claude 아티팩트 전용 window.storage API를
// 일반 브라우저의 localStorage로 대체하는 유틸입니다.
// 같은 get/set 시그니처를 유지해 App.jsx 코드를 최소한만 바꾸도록 했습니다.
export const storage = {
  async get(key) {
    try {
      const value = window.localStorage.getItem(key);
      if (value === null) return null;
      return { key, value, shared: false };
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return { key, value, shared: false };
    } catch {
      return null;
    }
  },
};
