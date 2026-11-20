# Output

stdout carries data only. stderr carries messages, progress, warnings and prompts.

## `--json`

stdout carries exactly one JSON document:

```json
{
  "schemaVersion": 1,
  "command": "config:get",
  "ok": true,
  "data": { "key": "telemetry", "value": "off" },
  "error": null,
  "warnings": [],
  "meta": { "cliVersion": "0.1.0", "traceId": null }
}
```

On failure `ok` is `false`, `data` is `null` and `error` is
`{ code, message, hint, httpStatus, traceId, docsUrl }`. Every warning is also in `warnings[]`. Prompts are off.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | ok |
| 1 | general error |
| 2 | usage or validation (bad flags, missing input with `--no-input`) |
| 3 | authentication required or expired |
| 4 | permission denied (403, missing scope) |
| 5 | not found |
| 6 | conflict or precondition (409, 412) |
| 7 | rate limited (429) |
| 8 | server error (5xx) |
| 9 | network or TLS |
| 10 | upgrade required (426) |
| 11 | cancelled by the user |
| 12 | payment or credits required (402) |

## Terminal behaviour

- Colour: `--color=auto|always|never`; `NO_COLOR` turns it off; no ANSI codes when not a terminal unless
  `--color=always`. Colour never carries meaning alone: every status is also a word (`ok`, `warn`, `failed`).
- Progress: a text line on a terminal; no spinner frames with `TERM=dumb` or `REVITION_ACCESSIBLE=1`; plain lines
  when piped.
- Tables: auto-width; `--plain` gives tab-separated output; long cells are truncated unless `--wide`.
- Long output goes through `$PAGER` (default `less -FRX`) on a terminal only.
- Prompts appear only when stdin and stdout are terminals and neither `--no-input` nor `--json` is set.
- Every output path passes through the redaction layer: tokens, keys and authorization headers show as `[REDACTED]`.
