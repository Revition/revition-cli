---
"@revition/plugin-assist": patch
---

Assist (T3.4.1): `apply_patch` places a hunk whose line numbers are off at the one place its old lines match (as
`patch` and `git apply` do), and a refusal shows the file's line beside the patch's. After a failed change, a read the
session already made is answered with that failure instead of being run again, so the assistant retries the change
instead of re-reading the same files.
