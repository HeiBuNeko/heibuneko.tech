import type os from "node:os";

export interface ICpu extends Omit<os.CpuInfo, "times"> {
  corePer: number[];
  coreAvg: number;
}

export interface ISystem {
  // uname
  machine: string;
  type: string;
  release: string;

  // CPU
  cpu: ICpu;
  loadavg: number[];

  // MEM
  freemem: number;
  totalmem: number;

  uptime: number;
}
