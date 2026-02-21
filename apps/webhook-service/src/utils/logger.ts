export function log(msg: string, meta?: Record<string, unknown>): void {
  const out = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
  console.log(new Date().toISOString(), out);
}
