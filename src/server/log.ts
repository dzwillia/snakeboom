/** One JSON line per entry on stdout, which `docker logs` collects. */
export function logLine(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
