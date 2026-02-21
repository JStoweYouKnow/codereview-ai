import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "./app";

describe("API", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/status returns gradient object", async () => {
    const res = await request(app).get("/api/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("gradient");
    expect(res.body.gradient).toHaveProperty("configured");
    expect(res.body.gradient).toHaveProperty("model");
  });
});
