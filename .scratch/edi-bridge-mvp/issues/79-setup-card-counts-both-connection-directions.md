# 79: Setup card counts both connection directions

**What to build:** The setup card on the partner page marks "Connections" as done only when every direction the partner needs has a connection. Today it is marked done as soon as one connection exists, even when the other direction was postponed in the add-a-partner wizard (tickets 62, 63).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] "Connections" stays open while a needed direction has no connection, and says which direction is missing
- [ ] It is done once every needed direction has a connection
- [ ] Unit tests cover one, both and no directions
