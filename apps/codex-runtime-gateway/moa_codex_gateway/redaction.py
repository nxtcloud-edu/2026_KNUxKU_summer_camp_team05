from __future__ import annotations

import logging
import re


_PATTERNS = (
    (re.compile(r"(?i)(bearer\s+)[a-z0-9._~+\-/]+=*"), r"\1[REDACTED]"),
    (re.compile(r"(?i)sk-[a-z0-9_-]{8,}"), "[REDACTED]"),
    (
        re.compile(
            r"(?i)(access[_-]?token|refresh[_-]?token|api[_-]?key)(\s*[:=]\s*)([^\s,}\]]+)"
        ),
        r"\1\2[REDACTED]",
    ),
)


def redact(value: object) -> str:
    text = str(value)
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(redact(item) for item in record.args)
        elif record.args:
            record.args = {key: redact(item) for key, item in record.args.items()}
        return True
