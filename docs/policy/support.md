# Support policy

## Supported CLI versions

| Release line | Supported |
|---|---|
| Current major | Fully: features, fixes and security fixes |
| Previous major | Security and critical fixes for **6 months** after the next major's first release |
| Older majors | Not supported |

A supported version receives fixes as new PATCH releases on its own major line.

## Supported Node.js versions

The CLI supports every Node.js release line that is in **Active LTS** or **Maintenance LTS** on the
[Node.js release schedule](https://nodejs.org/en/about/previous-releases). Today that is Node.js 22 and Node.js 24.

- A new LTS line is supported from the first CLI release after it enters Active LTS.
- A line whose Maintenance LTS has ended is dropped in the next CLI MAJOR release (see the
  [versioning policy](versioning.md), rule 7).
- CI tests every supported line on Linux, macOS and Windows.

## Minimum version enforced by the platform

The platform may refuse requests from CLI versions below a minimum. The notice periods are in the
[deprecation policy](deprecation.md).
