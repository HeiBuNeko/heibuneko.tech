import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

// Add a request interceptor
axios.interceptors.request.use(
  (config) => {
    // Do something before request is sent
    return config;
  },
  (error) => {
    // Do something with request error
    return Promise.reject(error);
  },
);

// Add a response interceptor
axios.interceptors.response.use(
  (response) => {
    // Any status code that lie within the range of 2xx cause this function to trigger
    // Do something with response data
    return response;
  },
  (error) => {
    // Any status codes that falls outside the range of 2xx cause this function to trigger
    // Do something with response error
    return Promise.reject(error);
  },
);

export const get = <T = unknown, D = unknown>(
  url: string,
  data?: D,
  config?: AxiosRequestConfig<D>,
): Promise<T> =>
  axios
    .request<T, AxiosResponse<T>, D>({
      ...config,
      url,
      method: "GET",
      params: data,
    })
    .then((res) => res.data);

export const post = <T = unknown, D = unknown>(
  url: string,
  data?: D,
  config?: AxiosRequestConfig<D>,
): Promise<T> =>
  axios
    .request<T, AxiosResponse<T>, D>({
      ...config,
      url,
      method: "POST",
      data,
    })
    .then((res) => res.data);
