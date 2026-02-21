import { PrismaClient } from "@codereview-ai/db";

const prisma = new PrismaClient();

export async function auditLog(
  action: "review_created" | "finding_posted" | "pattern_learned" | "finding_updated",
  metadata: Record<string, string | number | boolean | null>
) {
  try {
    await prisma.auditLog.create({
      data: { action, metadata: metadata as object },
    });
  } catch (err) {
    console.error("Audit log error:", err);
  }
}
