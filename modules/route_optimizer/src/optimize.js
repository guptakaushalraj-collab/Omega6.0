const EARTH_RADIUS_KM = 6371;

const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in kilometers.
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function distanceMatrix(points) {
  return points.map((from) => points.map((to) => Number(haversineKm(from, to).toFixed(4))));
}

// Greedy nearest-neighbor tour from a fixed start. Fast, and a decent
// starting point — but it can leave obvious crossings, which 2-opt then fixes.
function nearestNeighbor(start, stops) {
  const remaining = stops.map((s, i) => ({ ...s, _i: i }));
  const order = [];
  let current = start;

  while (remaining.length > 0) {
    let best = 0;
    let bestDist = haversineKm(current, remaining[0].location);
    for (let i = 1; i < remaining.length; i += 1) {
      const d = haversineKm(current, remaining[i].location);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    const [next] = remaining.splice(best, 1);
    order.push(next);
    current = next.location;
  }
  return order;
}

function tourLength(start, order) {
  let total = 0;
  let current = start;
  for (const stop of order) {
    total += haversineKm(current, stop.location);
    current = stop.location;
  }
  return total;
}

/**
 * 2-opt: repeatedly reverse a segment when doing so shortens the tour. This
 * removes the self-crossings that pure nearest-neighbor characteristically
 * leaves behind, typically buying 10-25% on realistic stop sets for a cost
 * that stays trivial at the scale of one worker's daily round.
 *
 * Open tour (no return to depot), so the trailing edge is not counted.
 */
function twoOpt(start, order, { maxPasses = 40 } = {}) {
  if (order.length < 3) return { order, passes: 0 };

  let best = order.slice();
  let bestLen = tourLength(start, best);
  let improved = true;
  let passes = 0;

  while (improved && passes < maxPasses) {
    improved = false;
    passes += 1;

    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = best
          .slice(0, i)
          .concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const len = tourLength(start, candidate);
        if (len < bestLen - 1e-9) {
          best = candidate;
          bestLen = len;
          improved = true;
        }
      }
    }
  }

  return { order: best, passes };
}

/**
 * @param {{lat,lng}} start
 * @param {Array<{id?, location:{lat,lng}, ...}>} stops
 * @param {{ refine?: boolean }} opts
 */
export function optimizeRoute(start, stops, { refine = true } = {}) {
  if (stops.length === 0) {
    return {
      stops: [],
      total_distance_km: 0,
      strategy: "empty",
      improvement_km: 0,
    };
  }

  const greedy = nearestNeighbor(start, stops);
  const greedyLen = tourLength(start, greedy);

  const { order, passes } = refine
    ? twoOpt(start, greedy)
    : { order: greedy, passes: 0 };
  const finalLen = tourLength(start, order);

  // Annotate each stop with its leg distance and cumulative progress.
  let cursor = start;
  let cumulative = 0;
  const sequenced = order.map((stop, index) => {
    const leg = haversineKm(cursor, stop.location);
    cumulative += leg;
    cursor = stop.location;
    const { _i, ...rest } = stop;
    return {
      ...rest,
      sequence: index + 1,
      leg_distance_km: Number(leg.toFixed(2)),
      cumulative_distance_km: Number(cumulative.toFixed(2)),
    };
  });

  return {
    stops: sequenced,
    total_distance_km: Number(finalLen.toFixed(2)),
    strategy: refine ? "nearest-neighbor + 2-opt" : "nearest-neighbor",
    two_opt_passes: passes,
    improvement_km: Number((greedyLen - finalLen).toFixed(2)),
  };
}
