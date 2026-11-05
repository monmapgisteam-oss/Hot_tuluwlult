// Төлөвлөгч хэдэн минут ажиллаж болох тул хөтчийн үндсэн урсгалыг гацаахгүй.
import type { Prepared } from "../suit";
import type { XY } from "./geom";
import { planSettlement, type PlanInputs } from "./runSettlement";
import { checks } from "./urban";

export type PlanRequest = { rings: XY[][]; prep: Prepared; inputs: PlanInputs };

self.addEventListener("message", async (e: MessageEvent<PlanRequest>) => {
  try {
    const plan = await planSettlement({ ...e.data, onStep: (text) => self.postMessage({ type: "step", text }) });
    self.postMessage({ type: "done", plan, checks: checks(plan) });
  } catch (err) {
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
});
