"""
Code review engine using DigitalOcean Gradient™ AI Serverless Inference.

Uses the Gradient SDK to call foundation models (Claude, Llama, etc.) via a single
API. Supports both commercial models (requires provider key in DO Control Panel)
and open-source models (work with Gradient model access key only).
"""
import json
import os
import re
import time
from pathlib import Path

from gradient import Gradient

# Retry config for Gradient API calls
MAX_RETRIES = 3
INITIAL_BACKOFF_SEC = 2
REQUEST_TIMEOUT_SEC = float(os.environ.get("GRADIENT_REQUEST_TIMEOUT", "90"))

# Load prompt template for legacy review endpoint
PROMPTS_DIR = Path(__file__).parent / "prompt_templates"
REVIEW_PROMPT = (PROMPTS_DIR / "code_review.txt").read_text()

# Model IDs: use anthropic-claude-* if provider key added, else open-source (llama, etc.)
DEFAULT_MODEL = os.environ.get(
    "GRADIENT_MODEL",
    "anthropic-claude-3.5-sonnet",
)


def _is_rate_limit_error(e: Exception) -> bool:
    """Check if exception indicates rate limit (429)."""
    err_str = str(e).lower()
    return "429" in err_str or "rate limit" in err_str or "rate_limit" in err_str


def _to_user_message(e: Exception) -> str:
    """Convert Gradient/SDK errors to user-friendly messages."""
    s = str(e).lower()
    if "429" in s or "rate limit" in s:
        return "Gradient AI rate limit exceeded. Try again shortly."
    if "401" in s or "403" in s or "unauthorized" in s or "forbidden" in s:
        return "Gradient AI authentication failed. Check GRADIENT_MODEL_ACCESS_KEY."
    if "timeout" in s or "timed out" in s:
        return "Gradient AI request timed out. Try with a smaller diff."
    if "500" in s or "502" in s or "503" in s:
        return "Gradient AI service temporarily unavailable. Retry later."
    return str(e)


def _call_with_retry(client, *, model, messages, max_tokens, temperature=0.3):
    """Call Gradient chat.completions with exponential backoff retry."""
    last_err = None
    backoff = INITIAL_BACKOFF_SEC
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
            return resp
        except Exception as e:
            last_err = e
            # Rate limit: use longer backoff
            if _is_rate_limit_error(e):
                backoff = max(backoff, 10)
            if attempt < MAX_RETRIES - 1:
                time.sleep(backoff)
                backoff *= 2
            else:
                raise Exception(_to_user_message(last_err)) from last_err
    raise Exception(_to_user_message(last_err)) from last_err


class ClaudeReviewEngine:
    """Analyzes PR diffs using DigitalOcean Gradient™ AI and returns structured findings."""

    def __init__(self, model_access_key: str | None = None):
        self.model_access_key = (
            model_access_key or os.environ.get("GRADIENT_MODEL_ACCESS_KEY")
        )
        self.client = (
            Gradient(model_access_key=self.model_access_key, timeout=REQUEST_TIMEOUT_SEC)
            if self.model_access_key
            else None
        )
        self.model = os.environ.get("GRADIENT_MODEL", DEFAULT_MODEL)

    def analyze_pr(
        self,
        diff: str,
        pr_title: str,
        patterns: list,
        repo_name: str,
    ) -> list:
        """Analyze PR diff with Gradient AI and return findings."""
        if not self.client:
            return _mock_findings(diff, pr_title)

        patterns_context = self._format_patterns(patterns)
        prompt = self._build_prompt(diff, pr_title, patterns_context, repo_name)

        resp = _call_with_retry(
            self.client,
            model=self.model,
            messages=[
                {"role": "system", "content": self._get_system_prompt()},
                {"role": "user", "content": prompt},
            ],
            max_tokens=4000,
            temperature=0.3,
        )

        content = resp.choices[0].message.content
        return self._parse_findings(content or "")

    def extract_patterns(self, findings: list) -> list:
        """Extract coding patterns from accepted findings."""
        if not self.client:
            return []

        findings_text = "\n\n".join(
            [
                f"Category: {f.get('category', '')}\n"
                f"Issue: {f.get('description', '')}\n"
                f"Code: {f.get('codeSnippet', '')}\n"
                f"Fix: {f.get('suggestion', '')}"
                for f in findings
            ]
        )

        prompt = f"""Analyze these accepted code review findings to extract team coding patterns.

Findings:
{findings_text}

For each pattern you identify, output JSON:
```json
[
  {{
    "category": "style|architecture|naming|testing",
    "pattern": "Brief pattern name",
    "description": "What the team prefers and why",
    "example": "Code example demonstrating the pattern"
  }}
]
```

Focus on:
- Consistent style choices (arrow functions vs function declarations)
- Architectural decisions (where to put business logic)
- Naming conventions (camelCase vs snake_case, prefixes)
- Testing practices (what gets tested, how)

Output ONLY the JSON array."""

        resp = _call_with_retry(
            self.client,
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": "You are analyzing code review patterns to understand team preferences.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=2000,
            temperature=0,
        )
        return self._parse_patterns(resp.choices[0].message.content or "")

    def _get_system_prompt(self) -> str:
        return """You are an expert code reviewer. Your style is direct, constructive, and pragmatic. You focus on real issues—security, bugs, performance—not nitpicks. You explain WHY something matters and offer specific fixes.

You have deep knowledge of:
- Security vulnerabilities (SQL injection, XSS, auth issues)
- Performance optimization (algorithms, database queries, memory leaks)
- Code quality (maintainability, readability, best practices)
- Common bugs and edge cases

You provide constructive, actionable feedback that helps developers improve.
You adapt your feedback based on the team's established patterns and preferences.

When reviewing code:
1. Identify genuine issues, not nitpicks
2. Explain WHY something is a problem
3. Provide specific suggestions for improvement
4. Consider the broader context of the change
5. Balance thoroughness with practicality

You output findings in JSON format."""

    def _build_prompt(
        self, diff: str, pr_title: str, patterns_context: str, repo_name: str
    ) -> str:
        diff_truncated = diff[:15000] if len(diff) > 15000 else diff
        return f"""Review this pull request for the repository: {repo_name}

**PR Title:** {pr_title}

**Team Coding Patterns:**
{patterns_context}

**Changes:**
{diff_truncated}

Analyze for:
1. **Security**: SQL injection, XSS, authentication/authorization issues, exposed secrets
2. **Bugs**: Logic errors, null pointer exceptions, race conditions, edge cases
3. **Performance**: Inefficient algorithms (O(n²) when O(n) is possible), N+1 queries, memory leaks
4. **Code Quality**: Overly complex code, duplication, poor naming, missing error handling
5. **Team Standards**: Violations of the team's established patterns

For each issue found, output JSON in this EXACT format:
```json
[
  {{
    "severity": "critical|warning|suggestion",
    "category": "security|bug|performance|quality|style",
    "title": "Brief title (under 60 chars)",
    "description": "Clear explanation of the issue",
    "suggestion": "Specific code fix or improvement",
    "filePath": "path/to/file.js",
    "lineStart": 42,
    "lineEnd": 45,
    "codeSnippet": "The problematic code",
    "confidence": 0.95
  }}
]
```

Rules:
- Only flag genuine issues worth developer attention
- "critical" = security vulnerabilities, data loss risks, production-breaking bugs
- "warning" = likely bugs, performance issues, maintainability concerns
- "suggestion" = style preferences, minor optimizations
- confidence: 0.0-1.0 (how certain you are this is a real issue)
- If no issues found, return empty array: []

Output ONLY the JSON array, no additional text."""

    def _format_patterns(self, patterns: list) -> str:
        if not patterns:
            return "No established team patterns yet."

        formatted = []
        for p in patterns[:10]:
            category = p.get("category", "general")
            description = p.get("description", "")
            confidence = p.get("confidence", 0.7)
            occurrences = p.get("occurrences", 1)
            if isinstance(confidence, (int, float)):
                conf_pct = f"{confidence:.0%}" if confidence <= 1 else f"{confidence}%"
            else:
                conf_pct = str(confidence)
            formatted.append(
                f"- {category}: {description} "
                f"(confidence: {conf_pct}, seen {occurrences} times)"
            )
        return "\n".join(formatted)

    def _parse_findings(self, response_text: str) -> list:
        """Extract JSON findings from model response with robust fallbacks."""
        candidates = []

        # Try 1: ```json ... ```
        json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", response_text)
        if json_match:
            candidates.append(json_match.group(1).strip())

        # Try 2: Bare JSON array [ ... ]
        array_match = re.search(r"\[\s*\{[\s\S]*\}\s*\]", response_text)
        if array_match:
            candidates.append(array_match.group(0))

        # Try 3: Raw response
        candidates.append(response_text.strip())

        for candidate in candidates:
            if not candidate:
                continue
            try:
                cleaned = re.sub(r",\s*}", "}", candidate)
                cleaned = re.sub(r",\s*]", "]", cleaned)
                findings = json.loads(cleaned)
                if not isinstance(findings, list):
                    continue
                validated = []
                for f in findings:
                    if not isinstance(f, dict) or not all(
                        k in f for k in ["severity", "category", "title", "description"]
                    ):
                        continue
                    validated.append({
                        "severity": str(f["severity"]),
                        "category": str(f["category"]),
                        "title": str(f["title"]),
                        "description": str(f["description"]),
                        "suggestion": str(f.get("suggestion", "")),
                        "filePath": str(f.get("filePath", "")),
                        "lineStart": int(f.get("lineStart", 1)),
                        "lineEnd": int(f.get("lineEnd", 1)),
                        "codeSnippet": str(f.get("codeSnippet", "")),
                        "confidence": float(f.get("confidence", 0.8)),
                    })
                return validated
            except (json.JSONDecodeError, ValueError, TypeError):
                continue

        print(f"Failed to parse model response. Preview: {response_text[:500]}")
        return []

    def _parse_patterns(self, response_text: str) -> list:
        """Parse pattern JSON from response with robust fallbacks."""
        candidates = []
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", response_text)
        if m:
            candidates.append(m.group(1).strip())
        m2 = re.search(r"\[\s*\{[\s\S]*\}\s*\]", response_text)
        if m2:
            candidates.append(m2.group(0))
        candidates.append(response_text.strip())
        for c in candidates:
            if not c:
                continue
            try:
                cleaned = re.sub(r",\s*}", "}", c)
                cleaned = re.sub(r",\s*]", "]", cleaned)
                out = json.loads(cleaned)
                return out if isinstance(out, list) else []
            except (json.JSONDecodeError, ValueError, TypeError):
                continue
        return []


def analyze_with_claude(
    diff: str, pr_title: str, patterns: list, repo_name: str
) -> list:
    """
    Analyze diff with Gradient AI and return structured findings.
    Wrapper for webhook pipeline compatibility.
    """
    engine = ClaudeReviewEngine()
    return engine.analyze_pr(diff, pr_title, patterns, repo_name)


def _mock_findings(diff: str, pr_title: str) -> list:
    """Placeholder findings when Gradient key not set."""
    return [
        {
            "severity": "suggestion",
            "category": "quality",
            "title": "Configure GRADIENT_MODEL_ACCESS_KEY for analysis",
            "description": "Set GRADIENT_MODEL_ACCESS_KEY to enable DigitalOcean Gradient™ AI code review.",
            "suggestion": "Create a model access key at cloud.digitalocean.com/gen-ai/model-access-keys",
            "filePath": "",
            "lineStart": 0,
            "lineEnd": 0,
            "codeSnippet": "",
            "confidence": 0.5,
        }
    ]


def handle_review_request(diff: str, title: str = "") -> str:
    """
    Call Gradient AI for code review (legacy /review endpoint).
    Returns markdown text.
    """
    engine = ClaudeReviewEngine()
    if not engine.client:
        return _mock_review(diff, title)

    diff_truncated = diff[:12000] if len(diff) > 12000 else diff
    prompt = REVIEW_PROMPT.format(diff=diff_truncated, title=title or "Untitled PR")

    try:
        resp = _call_with_retry(
            engine.client,
            model=engine.model,
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert code reviewer. Provide a structured markdown review with clear sections (Summary, Potential Issues, Suggestions, etc.).",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=3000,
            temperature=0.3,
        )
        content = (resp.choices[0].message.content or "").strip()
        if content:
            return content
        raise ValueError("Gradient returned empty content")
    except Exception as e:
        print(f"Gradient review error: {e}")
        raise


def _mock_review(diff: str, title: str) -> str:
    """Placeholder only when Gradient key is not set (client is None)."""
    return f"""## Code Review (placeholder)

**PR Title:** {title or "N/A"}

**Note:** Set `GRADIENT_MODEL_ACCESS_KEY` for AI-powered reviews.

**Diff length:** {len(diff)} chars

Configure your model access key at [cloud.digitalocean.com/gen-ai](https://cloud.digitalocean.com/gen-ai/model-access-keys)."""
