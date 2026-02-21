import { Router } from "express";
import { PrismaClient } from "@codereview-ai/db";
import axios from "axios";
import { auditLog } from "../utils/auditLog";

const router = Router();
const prisma = new PrismaClient();

const PATTERN_LEARNING_THRESHOLD = 3;
// Extract patterns when accepted count crosses 3, 6, 9... (batch)

/** Sample findings for demo/testing - lets judges explore without webhooks */
const DEMO_FINDINGS = [
  {
    severity: "critical",
    category: "security",
    title: "SQL injection risk in user query",
    description: "User input is concatenated directly into SQL without parameterization.",
    suggestion: "Use parameterized queries or an ORM to prevent SQL injection.",
    filePath: "src/api/users.ts",
    lineStart: 42,
    lineEnd: 45,
    codeSnippet: "db.query(`SELECT * FROM users WHERE id = ${id}`)",
    confidence: 0.95,
  },
  {
    severity: "warning",
    category: "performance",
    title: "N+1 query in list endpoint",
    description: "Related records are fetched in a loop, causing N+1 database calls.",
    suggestion: "Use eager loading or a single join query to fetch all related data.",
    filePath: "src/services/orders.ts",
    lineStart: 18,
    lineEnd: 22,
    codeSnippet: "orders.forEach(o => o.user = await getUser(o.userId))",
    confidence: 0.88,
  },
  {
    severity: "suggestion",
    category: "quality",
    title: "Consider extracting magic number",
    description: "The value 86400000 appears without context.",
    suggestion: "Define as named constant: const MS_PER_DAY = 86400000",
    filePath: "src/utils/date.ts",
    lineStart: 7,
    lineEnd: 7,
    codeSnippet: "return timestamp + 86400000",
    confidence: 0.75,
  },
];

/**
 * POST /api/demo/seed - Create sample review + findings for testing (no webhooks needed)
 */
router.post("/demo/seed", async (_req, res) => {
  try {
    const installation = await prisma.installation.upsert({
      where: { installationId: "demo-installation" },
      create: {
        platform: "github",
        installationId: "demo-installation",
        accountName: "demo",
        accountType: "organization",
        accessToken: "",
      },
      update: {},
    });

    const repository = await prisma.repository.upsert({
      where: {
        installationId_repoId: {
          installationId: installation.id,
          repoId: "demo-repo",
        },
      },
      create: {
        installationId: installation.id,
        repoId: "demo-repo",
        repoName: "codereview-ai",
        repoFullName: "demo/codereview-ai",
      },
      update: {},
    });

    const review = await prisma.review.create({
      data: {
        installationId: installation.id,
        repositoryId: repository.id,
        prNumber: 1,
        prTitle: "Add user authentication module",
        prAuthor: "demo-user",
        prUrl: "https://github.com/demo/codereview-ai/pull/1",
        status: "completed",
        filesChanged: 5,
        linesAdded: 120,
        linesDeleted: 30,
        completedAt: new Date(),
      },
    });

    for (const f of DEMO_FINDINGS) {
      await prisma.finding.create({
        data: {
          reviewId: review.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          description: f.description,
          suggestion: f.suggestion,
          filePath: f.filePath,
          lineStart: f.lineStart,
          lineEnd: f.lineEnd,
          codeSnippet: f.codeSnippet,
          confidence: f.confidence,
        },
      });
    }

    await auditLog("review_created", {
      reviewId: review.id,
      repositoryId: repository.id,
      prNumber: 1,
      source: "demo_seed",
    });

    res.json({
      message: "Demo data created",
      reviewId: review.id,
      findingsCount: DEMO_FINDINGS.length,
    });
  } catch (error) {
    console.error("Demo seed error:", error);
    res.status(500).json({ error: "Failed to create demo data" });
  }
});

/** In-memory cache for /api/status to avoid blocking on inference health (30s TTL) */
const STATUS_CACHE_TTL_MS = 30_000;
let statusCache: { gradient: { configured: boolean; model: string | null }; expires: number } | null = null;

/**
 * GET /api/status - Service & Gradient AI health (for dashboard indicator)
 * Cached 30s to avoid repeated 5s inference health checks.
 */
router.get("/status", async (_req, res) => {
  try {
    const now = Date.now();
    if (statusCache && statusCache.expires > now) {
      return res.json({ gradient: statusCache.gradient });
    }
    const inferenceUrl =
      process.env.INFERENCE_SERVICE_URL || "http://localhost:8000";
    let gradient = { configured: false, model: null as string | null };
    try {
      const { data } = await axios.get(`${inferenceUrl}/health`, {
        timeout: 5000,
      });
      gradient = {
        configured: data?.gradient?.configured ?? false,
        model: data?.gradient?.model ?? null,
      };
    } catch {
      /* inference unreachable */
    }
    statusCache = { gradient, expires: now + STATUS_CACHE_TTL_MS };
    res.json({ gradient });
  } catch (error) {
    console.error("API status error:", error);
    res.status(500).json({ gradient: { configured: false, model: null } });
  }
});

/**
 * GET /api/stats - Aggregate metrics for dashboard
 */
router.get("/stats", async (_req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [reviewsToday, totalReviews, findingsReviewed, completedReviews] =
      await Promise.all([
        prisma.review.count({
          where: { startedAt: { gte: today } },
        }),
        prisma.review.count(),
        prisma.finding.count({
          where: { wasAccepted: { not: null } },
        }),
        prisma.review.findMany({
        where: {
          status: "completed",
          completedAt: { not: null },
        },
        select: { startedAt: true, completedAt: true },
      }),
    ]);

    let avgResponseMs: number | null = null;
    if (completedReviews.length > 0) {
      const totalMs = completedReviews.reduce((sum, r) => {
        const completed = r.completedAt!;
        return sum + (completed.getTime() - r.startedAt.getTime());
      }, 0);
      avgResponseMs = Math.round(totalMs / completedReviews.length);
    }

    const avgResponse =
      avgResponseMs !== null
        ? avgResponseMs < 60000
          ? `${Math.round(avgResponseMs / 1000)}s`
          : `${Math.round(avgResponseMs / 60000)}m`
        : "—";

    res.json({
      reviewsToday,
      totalReviews,
      findingsReviewed,
      avgResponse,
      avgResponseMs,
    });
  } catch (error) {
    console.error("API stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

/**
 * GET /api/patterns - Team patterns learned from accepted findings
 */
router.get("/patterns", async (_req, res) => {
  try {
    const patterns = await prisma.teamPattern.findMany({
      include: {
        repository: { select: { repoFullName: true } },
      },
      orderBy: [{ repositoryId: "asc" }, { occurrences: "desc" }],
      take: 50,
    });
    const items = patterns.map((p) => ({
      id: p.id,
      category: p.category,
      pattern: p.pattern,
      description: p.description,
      occurrences: p.occurrences,
      confidence: p.confidence,
      examples: p.examples ?? [],
      repoFullName: p.repository.repoFullName,
    }));
    res.json({ items });
  } catch (error) {
    console.error("API patterns error:", error);
    res.status(500).json({ error: "Failed to fetch patterns" });
  }
});

/**
 * GET /api/reviews - Paginated list of reviews
 */
router.get("/reviews", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const status = req.query.status as string | undefined;

    const where = status ? { status } : {};

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        include: {
          repository: { select: { repoFullName: true } },
          _count: { select: { findings: true } },
        },
        orderBy: { startedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.review.count({ where }),
    ]);

    const items = reviews.map((r) => ({
      id: r.id,
      prNumber: r.prNumber,
      prTitle: r.prTitle,
      prAuthor: r.prAuthor,
      prUrl: r.prUrl,
      repoFullName: r.repository.repoFullName,
      status: r.status,
      findingsCount: r._count.findings,
      filesChanged: r.filesChanged,
      linesAdded: r.linesAdded,
      linesDeleted: r.linesDeleted,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    }));

    res.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("API reviews error:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

/**
 * GET /api/reviews/:id/findings - List findings for a review
 */
router.get("/reviews/:id/findings", async (req, res) => {
  try {
    const { id } = req.params;
    const review = await prisma.review.findUnique({
      where: { id },
      include: {
        findings: true,
        repository: { select: { repoFullName: true } },
      },
    });
    if (!review) {
      return res.status(404).json({ error: "Review not found" });
    }
    res.json({
      review: {
        id: review.id,
        prTitle: review.prTitle,
        prNumber: review.prNumber,
        prUrl: review.prUrl,
        repoFullName: review.repository.repoFullName,
      },
      findings: review.findings.map((f) => ({
        id: f.id,
        severity: f.severity,
        category: f.category,
        title: f.title,
        description: f.description,
        suggestion: f.suggestion,
        filePath: f.filePath,
        lineStart: f.lineStart,
        lineEnd: f.lineEnd,
        codeSnippet: f.codeSnippet,
        confidence: f.confidence,
        wasAccepted: f.wasAccepted,
      })),
    });
  } catch (error) {
    console.error("API findings error:", error);
    res.status(500).json({ error: "Failed to fetch findings" });
  }
});

/**
 * PATCH /api/findings/:id - Update finding feedback (wasAccepted)
 */
router.patch("/findings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as { wasAccepted?: boolean };
    if (typeof body.wasAccepted !== "boolean") {
      return res.status(400).json({ error: "wasAccepted (boolean) required" });
    }

    const finding = await prisma.finding.findUnique({
      where: { id },
      include: {
        review: { include: { repository: true } },
      },
    });
    if (!finding) {
      return res.status(404).json({ error: "Finding not found" });
    }

    await prisma.finding.update({
      where: { id },
      data: { wasAccepted: body.wasAccepted },
    });

    await auditLog("finding_updated", {
      findingId: id,
      reviewId: finding.reviewId,
      wasAccepted: body.wasAccepted,
    });

    // Trigger pattern extraction when enough findings accepted for this repo
    if (body.wasAccepted) {
      await maybeExtractPatterns(finding.review.repositoryId);
    }

    res.json({ id, wasAccepted: body.wasAccepted });
  } catch (error) {
    console.error("API PATCH finding error:", error);
    res.status(500).json({ error: "Failed to update finding" });
  }
});

/**
 * Call inference extract-patterns and upsert to TeamPattern when threshold reached
 */
async function maybeExtractPatterns(repositoryId: string) {
  const accepted = await prisma.finding.findMany({
    where: {
      review: { repositoryId },
      wasAccepted: true,
    },
    include: { review: true },
    take: 50,
  });

  if (accepted.length < PATTERN_LEARNING_THRESHOLD) return;
  // Only extract when we cross a batch boundary (3, 6, 9...) to avoid redundant calls
  if (accepted.length % PATTERN_LEARNING_THRESHOLD !== 0) return;

  const inferenceUrl =
    process.env.INFERENCE_SERVICE_URL || "http://localhost:8000";
  const findingsForApi = accepted.map((f) => ({
    category: f.category,
    description: f.description,
    codeSnippet: f.codeSnippet,
    suggestion: f.suggestion,
  }));

  try {
    const { data } = await axios.post(
      `${inferenceUrl}/extract-patterns`,
      { findings: findingsForApi },
      { timeout: 30000 }
    );
    const patterns = data.patterns ?? [];
    if (patterns.length === 0) return;

    for (const p of patterns) {
      const existing = await prisma.teamPattern.findFirst({
        where: {
          repositoryId,
          category: p.category,
          pattern: p.pattern ?? "",
        },
      });
      const examples = p.example ? [p.example] : [];
      if (existing) {
        await prisma.teamPattern.update({
          where: { id: existing.id },
          data: {
            occurrences: existing.occurrences + 1,
            description: p.description ?? existing.description,
            examples: [...(existing.examples || []), ...examples].slice(-5),
          },
        });
      } else {
        await prisma.teamPattern.create({
          data: {
            repositoryId,
            category: p.category ?? "general",
            pattern: p.pattern ?? "",
            description: p.description ?? "",
            occurrences: 1,
            confidence: 0.7,
            examples,
          },
        });
      }
      await auditLog("pattern_learned", {
        repositoryId,
        category: p.category ?? "general",
        pattern: p.pattern ?? "",
      });
    }
  } catch (err) {
    console.error("Pattern extraction failed:", err);
  }
}

export const apiRouter = router;
