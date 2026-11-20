# @revition/e2e-fixture-plugin

Test fixture, not for use.

This package exists only so the Revition CLI's plugin checks (signature, provenance, registered publisher, org
allowlist) can be proven end to end with a real signed package (REVITION-CLI-PLAN T4.2.3). It is published by
`.github/workflows/release.yml` through npm trusted publishing, and is unpublished, or deprecated if npm refuses,
within 72 hours of that publish.
