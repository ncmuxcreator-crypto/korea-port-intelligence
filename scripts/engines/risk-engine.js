
export function calculateRisk(v) {
  let score = 0;

  if (v.status.includes("Waiting")) score += 25;
  if (v.days_in_korea >= 14) score += 35;
  if (v.destination === "Australia") score += 40;
  if (v.speed <= 3) score += 15;

  return score;
}
