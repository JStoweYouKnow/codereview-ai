"""Tests for Gradient AI code review engine - parsing and error detection."""
import pytest
from claude_handler import ClaudeReviewEngine, _is_rate_limit_error


class TestParseFindings:
    """Tests for _parse_findings output structure and fallbacks."""

    def test_parses_json_block(self):
        engine = ClaudeReviewEngine()
        text = '''```json
[
  {"severity": "critical", "category": "security", "title": "XSS risk", "description": "User input not escaped.", "suggestion": "Escape output.", "filePath": "a.ts", "lineStart": 1, "lineEnd": 2, "codeSnippet": "echo x", "confidence": 0.9}
]
```'''
        out = engine._parse_findings(text)
        assert len(out) == 1
        assert out[0]["severity"] == "critical"
        assert out[0]["title"] == "XSS risk"
        assert out[0]["confidence"] == 0.9

    def test_parses_bare_array(self):
        engine = ClaudeReviewEngine()
        text = '[{"severity":"suggestion","category":"quality","title":"Magic number","description":"Use constant","suggestion":"Const X=1","filePath":"","lineStart":1,"lineEnd":1,"codeSnippet":"","confidence":0.7}]'
        out = engine._parse_findings(text)
        assert len(out) == 1
        assert out[0]["category"] == "quality"

    def test_fixes_trailing_commas(self):
        engine = ClaudeReviewEngine()
        text = '[{"severity":"warning","category":"perf","title":"T","description":"D","suggestion":"S","filePath":"f","lineStart":1,"lineEnd":1,"codeSnippet":"",}]'
        out = engine._parse_findings(text)
        assert len(out) == 1

    def test_returns_empty_for_invalid(self):
        engine = ClaudeReviewEngine()
        assert engine._parse_findings("not json at all") == []
        assert engine._parse_findings("[1,2,3]") == []
        assert engine._parse_findings('{"x":1}') == []

    def test_defaults_missing_fields(self):
        engine = ClaudeReviewEngine()
        text = '[{"severity":"critical","category":"security","title":"T","description":"D"}]'
        out = engine._parse_findings(text)
        assert len(out) == 1
        assert out[0].get("suggestion", "") == ""
        assert out[0].get("codeSnippet", "") == ""
        assert out[0]["lineStart"] == 1
        assert out[0]["confidence"] == 0.8


class TestParsePatterns:
    """Tests for _parse_patterns output."""

    def test_parses_json_block(self):
        engine = ClaudeReviewEngine()
        text = '''```json
[{"category":"style","pattern":"Use arrow functions","description":"Team prefers arrows","example":"const fn = () => {}"}]
```'''
        out = engine._parse_patterns(text)
        assert len(out) == 1
        assert out[0]["category"] == "style"
        assert "arrow" in out[0]["pattern"].lower()

    def test_returns_empty_for_invalid(self):
        engine = ClaudeReviewEngine()
        assert engine._parse_patterns("garbage") == []
        assert engine._parse_patterns("{}") == []


class TestRateLimitDetection:
    """Tests for rate limit error detection."""

    def test_detects_429(self):
        assert _is_rate_limit_error(Exception("HTTP 429 Too Many Requests")) is True

    def test_detects_rate_limit_text(self):
        assert _is_rate_limit_error(Exception("rate limit exceeded")) is True
        assert _is_rate_limit_error(Exception("rate_limit_error")) is True

    def test_ignores_other_errors(self):
        assert _is_rate_limit_error(Exception("500 Internal Server Error")) is False
        assert _is_rate_limit_error(Exception("Connection timeout")) is False
