from flask import Flask, request, jsonify
from claude_handler import ClaudeReviewEngine, handle_review_request

app = Flask(__name__)
engine = ClaudeReviewEngine()


def _safe_model_name(name: str | None) -> str | None:
    """Never expose secrets (e.g. if GRADIENT_MODEL was misconfigured with access key)."""
    if not name or not isinstance(name, str):
        return None
    if name.startswith("sk-") or len(name) > 80:
        return "configured"
    return name


@app.route("/health", methods=["GET"])
def health():
    gradient_ready = engine.client is not None
    model = _safe_model_name(engine.model) if gradient_ready else None
    return jsonify({
        "status": "healthy",
        "gradient": {
            "configured": gradient_ready,
            "model": model,
        },
    })


@app.route("/analyze", methods=["POST"])
def analyze():
    """Endpoint for webhook service - returns structured findings."""
    data = request.get_json() or {}
    diff = data.get("diff", "")
    pr_title = data.get("prTitle", "")
    patterns = data.get("patterns", [])
    repo_name = data.get("repoName", "")

    if not diff:
        return jsonify({"error": "diff is required", "findings": []}), 400

    try:
        findings = engine.analyze_pr(
            diff=diff,
            pr_title=pr_title,
            patterns=patterns,
            repo_name=repo_name,
        )
        return jsonify({"findings": findings})
    except Exception as e:
        return jsonify({"error": str(e), "findings": []}), 500


@app.route("/extract-patterns", methods=["POST"])
def extract_patterns():
    """Extract team patterns from accepted findings (Phase 3)."""
    data = request.get_json() or {}
    findings = data.get("findings", [])

    if not findings:
        return jsonify({"patterns": []}), 200

    try:
        patterns = engine.extract_patterns(findings)
        return jsonify({"patterns": patterns})
    except Exception as e:
        return jsonify({"error": str(e), "patterns": []}), 500


@app.route("/review", methods=["POST"])
def review():
    """Legacy endpoint - returns markdown review text."""
    data = request.get_json() or {}
    diff = data.get("diff", "")
    title = data.get("title", "")

    if not diff:
        return jsonify({"error": "diff is required"}), 400

    try:
        review_text = handle_review_request(diff, title)
        return jsonify({"review": review_text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
