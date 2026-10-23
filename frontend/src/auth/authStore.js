let accessToken = null;

export const setToken = (t) => {
  accessToken = t;
};

export const getToken = () => accessToken;

export const clearToken = () => {
  accessToken = null;
};
