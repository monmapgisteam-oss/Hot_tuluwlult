// Замын уулзвар, метрээр зурсан тэмдэглэгээг үндсэн газрын зургийг гацаалгүй бэлтгэнэ.
import { settlementRoadDisplay, type SettlementRoadDisplay, type SettlementRoadPlan } from "./settlementRoads";

export type RoadDisplayResponse = { type: "done"; display: SettlementRoadDisplay } | { type: "error"; message: string };

self.addEventListener("message", (e: MessageEvent<SettlementRoadPlan>) => {
  try {
    const response: RoadDisplayResponse = { type: "done", display: settlementRoadDisplay(e.data) };
    self.postMessage(response);
  } catch (error) {
    const response: RoadDisplayResponse = { type: "error", message: error instanceof Error ? error.message : String(error) };
    self.postMessage(response);
  }
});
