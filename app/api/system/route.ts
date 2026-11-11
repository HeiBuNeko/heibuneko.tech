import os from "node:os";
import { NextResponse } from "next/server";
import type { ICpu } from "@/app/types/system";

const sumTimes = (times: os.CpuInfo["times"]) =>
  times.user + times.nice + times.sys + times.idle + times.irq;

/**
 * 服务器 CPU 占用率采样器
 */
export class CpuMonitor {
  private static previous = os.cpus();

  private static metrics: ICpu = {
    model: "",
    speed: 0,
    corePer: [],
    coreAvg: 0,
  };

  /**
   * 启动 CPU 占用率采样
   */
  constructor() {
    setInterval(() => {
      let sum = 0;
      const next = os.cpus();
      const corePer = next.map(({ times }, index) => {
        const before = CpuMonitor.previous[index]?.times;
        const total = sumTimes(times) - sumTimes(before);
        const idle = times.idle - before.idle;
        const usage = ((total - idle) / total) * 100;
        sum += usage;
        return usage;
      });
      CpuMonitor.metrics = {
        model: next[0].model,
        speed: next[0].speed,
        corePer,
        coreAvg: sum / next.length,
      };
      CpuMonitor.previous = next;
    }, 1000);
  }

  /**
   * 返回最近一次采样结果
   *
   * @returns 各核心的型号、主频和占用率
   */
  static getMetrics(): ICpu {
    return CpuMonitor.metrics;
  }
}

new CpuMonitor();

export async function GET() {
  // uname
  const machine = os.machine();
  const type = os.type();
  const release = os.release();

  // CPU
  const cpu = CpuMonitor.getMetrics();
  const loadavg = os.loadavg();

  // MEM
  const freemem = os.freemem();
  const totalmem = os.totalmem();

  const uptime = os.uptime();

  return NextResponse.json({
    machine,
    type,
    release,
    cpu,
    loadavg,
    freemem,
    totalmem,
    uptime,
  });
}
