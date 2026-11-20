# Telemetry

Telemetry is off unless you turn it on. The first interactive run asks once (the default answer is No); a
non-interactive first run never asks and stays off.

Precedence, strongest first: `DO_NOT_TRACK=1` or `REVITION_TELEMETRY=0` turn it off, whatever the config says; then
`revition telemetry enable|disable`; unset means off.

## What one event contains

| Field | Example |
| --- | --- |
| `schemaVersion` | `1` |
| `installId` | a random id made on this machine (reset when you opt out) |
| `cliVersion` | `0.1.0` |
| `os` | `darwin`, `linux` or `win32` |
| `nodeMajor` | `22` |
| `command` | `apps:list` (the command id only) |
| `flagsUsed` | `["json", "profile"]` (flag names only, never their values) |
| `exitCode` | `0` |
| `durationMs` | `840` |
| `ci` | `false` |
| `timestamp` | `2026-11-18T10:00:00.000Z` |

Never collected: user or org ids, paths, argument or flag values, hosts, error text.

## How it is sent

Events are queued on this machine and sent after the command finishes, by a background process, so a command is never
slowed or failed by telemetry. They go to `POST /dev/cli/telemetry` on the Developer API, so only signed-in users send.
The platform drops who sent them before storing anything and keeps only daily counters per CLI version, OS, command
and exit code.

## Commands

- `revition telemetry status`: on or off, and why.
- `revition telemetry enable` / `disable`: opt in or out (opting out resets the install id).
- `revition telemetry show-last`: the last 20 events exactly as they were sent.
