# 76: Plain on-screen names on the remaining screens

**What to build:** Every screen uses the on-screen names from `GLOSSARY.md`, in English and German. The rebuilt screens already do; the screens that were not rebuilt still show domain terms: "Run", "Flow", "Channel", "Lookup Table", "Trading Partner" and "Sample Document" appear on the connection and route screens, their forms, the mapping editor and the navigation, in both languages (tickets 60, 66). German screens also say "Workspace" in many places, where the glossary says "Arbeitsbereich" (tickets 69, 70).

German pages show the meanings of codes in English ("Piece", "Carton"), because the mock data has English meanings only, and no seeded document shows the "no translation" marker on the Content tab any more (ticket 67).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] No screen text uses a domain term where the glossary gives an on-screen name, in English and German; commits, code, contracts and the API keep the domain terms
- [ ] German screens say "Arbeitsbereich", not "Workspace"
- [ ] The mock code meanings come in English and German, and German pages show the German meanings
- [ ] At least one seeded document shows the "no translation" marker on its Content tab
- [ ] A test fails when a message in either language uses a domain term that has an on-screen name
- [ ] Stories and tests stay green
