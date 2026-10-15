# Message Type structures

`structures.ts` builds the ORDERS, DESADV and INVOIC structures from the UN D.96A segments in `directory.ts`, and narrows them to EANCOM 1997 where a public GS1 source gives the EANCOM value. The full EANCOM 1997 tables are only in the licensed EANCOM manual. This file lists each EANCOM value that a segment use sets and the source that gives it. The sources are the same as for the golden files of `packages/edifact`, see [its README](../../../edifact/golden/README.md):

- CCG ORDERS, CCG DESADV and CCG INVOIC: the GS1 Germany CCG recommendations for EANCOM 1997, update 2005 ([ORDERS](https://events.gs1.de/common/downloads/gs1_tech/2075_1997_orders.pdf), [DESADV](https://events.gs1.de/common/downloads/gs1_tech/2071_1997_desadv.pdf), [INVOIC](https://events.gs1.de/common/downloads/gs1_tech/2072_1997_invoic.pdf)), section 7, segment layout. Page numbers are printed page numbers; the PDF page is one higher.
- MS30, MS34 and MS35: the GS1 Sweden ESAP 20 mapping specifications for EANCOM 1997 (D.96A), version 1.8.0, 2023-05-29 ([MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), [MS34 Leveransavisering](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms34_desadv_se-1.pdf), [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf)).

## Composites required in use

UN D.96A leaves these composites conditional (`C`). The segment uses mark them as required, so a present segment without them fails. EANCOM marks a conditional entry as required (`R`), advised (`A`), dependent (`D`), optional (`O`) or not used (`N`).

| Composite | Segment uses                                    | Status and source                                                                                       |
| --------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| C082      | NAD+BY, NAD+SU, NAD+DP, NAD+IV in ORDERS        | `R` in MS30: SU on pages 2 and 3, BY and DP on page 3, IV on page 4                                     |
| C082      | NAD+BY, NAD+SU, NAD+DP in DESADV                | `R` in MS34: SU on page 2, BY and DP on page 3                                                          |
| C082      | NAD+BY, NAD+SU, NAD+IV, NAD+DP in INVOIC        | `R` in MS35: SU on page 3, BY, DP and IV on page 4                                                      |
| C212      | LIN in ORDERS SG25, DESADV SG17 and INVOIC SG25 | `R` in MS30 page 4, MS34 page 4 and MS35 page 9, for the LIN that carries the GTIN                      |
| C509      | PRI+AAA in ORDERS SG28 and INVOIC SG28          | `R` in CCG ORDERS printed page 143 and CCG INVOIC printed page 343; `R` in MS30 page 4 and MS35 page 10 |

The CCG recommendations give other statuses for two of them. C082 is `A` (advised) in CCG ORDERS printed page 105, CCG DESADV printed page 138 and CCG INVOIC printed page 267, each for NAD+BY. C212 is `D` (dependent) in CCG ORDERS printed page 129, CCG DESADV printed page 182 and CCG INVOIC printed page 315. The structures follow the ESAP status `R`.

The key composites of RFF (C506), DTM (C507), QTY (C186) and MOA (C516) are mandatory (`M`) in the UN D.96A segments already, and `M` in the CCG recommendations, for example C507 of DTM+137 in CCG INVOIC printed page 233. The segment uses do not need to mark them.

## Association assigned code

UNH S009 0057 is conditional in UN syntax version 3 and required (`R`) in EANCOM. The header of each structure narrows it to the EAN version control number of the CCG recommendation for EANCOM 1997:

| Message Type | 0057     | Source                      | Example in the source                  |
| ------------ | -------- | --------------------------- | -------------------------------------- |
| ORDERS       | `EAN008` | CCG ORDERS printed page 90  | `UNH+ME0001+ORDERS:D:96A:UN:EAN008'`   |
| DESADV       | `EAN005` | CCG DESADV printed page 122 | `UNH+ME000001+DESADV:D:96A:UN:EAN005'` |
| INVOIC       | `EAN008` | CCG INVOIC printed page 230 | `UNH+ME000001+INVOIC:D:96A:UN:EAN008'` |

The ESAP 20 specifications give later subset versions: `EAN009` in MS30 page 1 and MS35 page 1, `EAN006` in MS34 page 1. CONTRL keeps 0057 without a code list, in UNH and in UCM; see the CONTRL definition in the golden files README for `EAN002` and `EAN004`.

## Item description

IMD describes a line item. The EDIFACT column of the CCG layout gives the UN D.96A segment: 7077, 7081, C273 (7009, 1131, 3055, 7008). The free text in 7008 is the fourth component of the third element. The structures follow the CCG use of IMD for the item description:

| Message Type | Use     | Source                      | Example in the source         |
| ------------ | ------- | --------------------------- | ----------------------------- |
| INVOIC       | `IMD+A` | CCG INVOIC printed page 321 | `IMD+A++:::Rudi Rüssel'`      |
| DESADV       | `IMD+A` | CCG DESADV printed page 212 | `IMD+A++:::Rüssel von Rudi'`  |
| ORDERS       | `IMD+A` | none                        | same use as INVOIC and DESADV |

7077 `A` is the free-form long description. CCG INVOIC marks 7081, 7009, 1131 and 3055 as not used (`N`), so the IMD use leaves 3055 without a code and it does not fill itself. CCG ORDERS gives IMD only for colour and size (`IMD+B+SGR+:::XXL'`, printed page 133), so ORDERS keeps the same use as the others.
