# 32: Outbound SFTP delivery

**What to build:** Runs deliver their output Interchange to an outbound SFTP Channel and reach status delivered, with one Message per Interchange and a correct UNB envelope (sender and receiver GLNs, syntax settings, control reference).

**Blocked by:** 31 (Runs from Manual Submission)

**Status:** ready-for-agent

- [ ] Built test-first (red → green, vertical slices) at the agreed seam (worker pipeline; SFTP via Testcontainers)
- [ ] The delivered file appears on the SFTP server with the expected content
- [ ] Each outbound Interchange contains exactly one Message
- [ ] An unreachable SFTP target fails the Run at the delivery stage
- [ ] Channel secrets are decrypted only inside the worker
