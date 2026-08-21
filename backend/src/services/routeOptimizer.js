import { haversineDistanceKm } from "../utils/geo.js";

// Orders a worker's stops with a nearest-neighbor heuristic starting from
// their current location. Not optimal TSP, but O(n^2) and good enough for
// the handful of daily stops a collection worker actually has — and it
// gives a real "greedy shortest-next-hop" route rather than a fixed list.
export function optimizeRoute(startLocation, stops) {
  const remaining = [...stops];
  const ordered = [];
  let current = startLocation;
  let totalDistanceKm = 0;

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = haversineDistanceKm(current, remaining[0].location);
    for (let i = 1; i < remaining.length; i += 1) {
      const dist = haversineDistanceKm(current, remaining[i].location);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    totalDistanceKm += bestDist;
    ordered.push({ ...next, legDistanceKm: Number(bestDist.toFixed(2)) });
    current = next.location;
  }

  return { stops: ordered, totalDistanceKm: Number(totalDistanceKm.toFixed(2)) };
}
