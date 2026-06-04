// ===== TSP (Travelling Salesman) — open path with start + optional end =====
// Algorithm: Nearest-Neighbor heuristic + 2-opt improvement
// Supports: round trip (start == end) OR open path (different end)

const TSP = {
  // Nearest-neighbor TSP heuristic
  // If end is provided: open path (start → ... → end, don't return)
  // If end is null: round trip (return to start)
  nearestNeighbor(start, customers, end) {
    if (customers.length === 0) return [];
    if (customers.length === 1) return [customers[0].id];

    const remaining = [...customers];
    const order = [];
    let current = { lat: start.lat, lng: start.lng, id: 'start' };

    while (remaining.length > 0) {
      let nearestIdx = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = Utils.haversine(current.lat, current.lng, remaining[i].lat, remaining[i].lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIdx = i;
        }
      }
      const next = remaining.splice(nearestIdx, 1)[0];
      order.push({ id: next.id, dist: nearestDist });
      current = next;
    }

    return order.map(o => o.id);
  },

  // 2-opt improvement (swap to reduce total distance)
  // end: optional endpoint to consider
  twoOpt(route, start, end) {
    if (route.length < 3) return route;
    const customers = Storage.getActiveCustomers();
    const custMap = new Map(customers.map(c => [c.id, c]));

    function totalDistance(order) {
      let total = 0;
      let prev = { lat: start.lat, lng: start.lng };
      for (const id of order) {
        const c = custMap.get(id);
        if (!c) continue;
        total += Utils.haversine(prev.lat, prev.lng, c.lat, c.lng);
        prev = c;
      }
      // Add distance to endpoint
      const finalPoint = end || start;
      total += Utils.haversine(prev.lat, prev.lng, finalPoint.lat, finalPoint.lng);
      return total;
    }

    let best = [...route];
    let bestDist = totalDistance(best);
    let improved = true;
    let iter = 0;
    const maxIter = 50;

    while (improved && iter < maxIter) {
      improved = false;
      iter++;
      for (let i = 0; i < best.length - 1; i++) {
        for (let j = i + 1; j < best.length; j++) {
          const newRoute = [
            ...best.slice(0, i),
            ...best.slice(i, j + 1).reverse(),
            ...best.slice(j + 1),
          ];
          const newDist = totalDistance(newRoute);
          if (newDist < bestDist * 0.999) {
            best = newRoute;
            bestDist = newDist;
            improved = true;
          }
        }
      }
    }
    return best;
  },

  // Plan route: nearest-neighbor + 2-opt
  // start: {lat, lng} — required
  // customerIds: array of customer IDs to visit
  // end: {lat, lng} — optional endpoint (default: return to start = round trip)
  plan(start, customerIds, end) {
    const allCustomers = Storage.getActiveCustomers();
    const selectedCustomers = customerIds
      .map(id => allCustomers.find(c => c.id === id))
      .filter(Boolean);
    if (selectedCustomers.length === 0) return [];

    // Step 1: nearest-neighbor
    const nnOrder = this.nearestNeighbor(start, selectedCustomers, end);
    // Step 2: improve with 2-opt
    const optimized = this.twoOpt(nnOrder, start, end);
    return optimized;
  },
};

window.TSP = TSP;
