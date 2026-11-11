import useSWR from "swr";
import { get } from "../lib/fetcher";
import type { ISystem } from "../types/system";

export const useSystem = () =>
  useSWR("/api/system", get<ISystem>, {
    refreshInterval: 1000,
  });
