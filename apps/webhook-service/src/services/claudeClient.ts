const INFERENCE_URL = process.env.INFERENCE_SERVICE_URL || "http://localhost:8000";

export async function requestClaudeReview(diff: string, title: string): Promise<string> {
  const res = await fetch(`${INFERENCE_URL}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ diff, title }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Inference service: ${res.status} - ${err}`);
  }
  const data = await res.json();
  return data.review || data;
}
