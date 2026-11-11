import { Card, Label, Meter } from "@heroui/react";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { useSystem } from "@/app/hooks/useSystem";
import { formatBytes } from "@/app/utils/format";

dayjs.extend(duration);

export const System = () => {
  const { data } = useSystem();
  return (
    <div className="flex w-100 flex-col gap-4 font-thin">
      <Card
        className="border border-solid border-white/10 backdrop-blur-sm"
        variant="transparent"
      >
        <div>
          系统信息：{data?.type} {data?.release} {data?.machine}
        </div>
        <div>
          运行时间：
          {dayjs
            .duration(data?.uptime || 0, "seconds")
            .format("D[天] H[小时] m[分] s[秒]")}
        </div>
      </Card>
      <div className="flex gap-4 text-2xl">
        <Card
          className="w-full border border-solid border-white/10 backdrop-blur-sm"
          variant="transparent"
        >
          <Meter value={data?.cpu.coreAvg}>
            <Label className="font-thin">CPU</Label>
            <Meter.Output className="font-thin" />
            <Meter.Track>
              <Meter.Fill />
            </Meter.Track>
          </Meter>
          <Card.Footer className="text-xs">
            平均负载：{data?.loadavg.map((i) => i.toFixed(1)).join(" / ")}
          </Card.Footer>
        </Card>
        <Card
          className="w-full border border-solid border-white/10 backdrop-blur-sm"
          variant="transparent"
        >
          <Card.Content>
            <Meter
              value={
                data && ((data.totalmem - data.freemem) / data.totalmem) * 100
              }
            >
              <Label className="font-thin">MEM</Label>
              <Meter.Output className="font-thin" />
              <Meter.Track>
                <Meter.Fill />
              </Meter.Track>
            </Meter>
          </Card.Content>
          <Card.Footer className="text-xs">
            空闲 {data && formatBytes(data.freemem)} 总{" "}
            {data && formatBytes(data.totalmem)}
          </Card.Footer>
        </Card>
      </div>
    </div>
  );
};
