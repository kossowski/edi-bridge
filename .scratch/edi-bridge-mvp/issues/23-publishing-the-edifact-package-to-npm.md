# 23: Publishing the edifact package to npm

**What to build:** The edifact package is versioned and published to npm with Changesets from CI, with a changelog and its own README.

**Blocked by:** 22 (DESADV and CONTRL definitions)

**Status:** ready-for-human

- [ ] The maintainer reserves the npm org edi-bridge and provides the publish token as a CI secret
- [ ] Changesets drives versioning and the changelog
- [ ] A release workflow publishes the package from main
- [ ] The package README documents parse, validate and serialize with examples
