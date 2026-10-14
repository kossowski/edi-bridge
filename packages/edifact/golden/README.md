# Golden files

Each valid ORDERS, DESADV and INVOIC Interchange is a subset of the segment examples ("Exempel") in a GS1 Sweden ESAP 20 mapping specification for EANCOM 1997 (D.96A), version 1.8.0, 2023-05-29. The source lists alternative segments side by side, so its own UNT count does not match its examples. Each file keeps one coherent alternative per segment in message order, with the example values unchanged, and sets UNT to the segments it keeps. The valid CONTRL Interchanges build on the example messages of the GS1 CONTRL manual, see [CONTRL definition](#contrl-definition).

The expected `.json` files are written by hand from the `.edi` files, never from parse output. The test reads both as ISO 8859-1 (UNOC): non-ASCII characters are single Latin-1 bytes in the `.edi` files and `\u` escapes in the `.json` files.

| Golden file                               | Source                                                                                                                        | Deviations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orders-without-una.edi`                  | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), pages 1 to 5                              | UNA dropped. 14 of the 29 examples from UNH to UNT, UNT `14` instead of `24`. No line breaks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `orders-with-multiple-messages.edi`       | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), pages 1 to 5                              | CRLF after each segment. Message 1: 14 of the 29 examples, UNT `14`. Message 2 is added: a smaller subset with message reference `234568` and order number `73000152012297655`, UNT `10`. UNZ counts `2` Messages.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `orders-with-mixed-line-breaks.edi`       | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), pages 1 to 5                              | The segments of `orders-without-una.edi` with UNA `UNA:+.? '` added. The gaps mix LF, CRLF, CR and no line break, and CRLF follows the last segment.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `orders-without-una-with-blank-lines.edi` | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), pages 1 to 5                              | The segments of `orders-without-una.edi`. CRLF before UNB. The gaps hold runs of CR and LF characters, blank lines included, and two CRLF follow the last segment.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `desadv-with-una.edi`                     | [MS34 Leveransavisering](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms34_desadv_se-1.pdf), pages 1 to 7                | LF after each segment. 21 of the 40 examples from UNH to UNT, UNT `21` instead of `35`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `invoic-with-release-characters.edi`      | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), pages 1 to 13                           | LF after each segment. 21 of the 82 examples from UNH to UNT, UNT `21` instead of `76`. The FTX free text (page 10) keeps its released colon `(1994?:200)` and its Latin-1 characters. It is split into two components after `som`, because data element 4440 is `an..70` in MS35 and UN D.96A.                                                                                                                                                                                                                                                                                                                    |
| `invoic-with-custom-delimiters.edi`       | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), pages 1 to 13                           | UNA changed to `UNA\|^,! ~` and every delimiter replaced to match. PRI uses the decimal comma (`36,1`). The colon in `(1994:200)` is plain text under these delimiters, so it has no release. The FTX free text is split as in `invoic-with-release-characters.edi`. 12 of the 82 examples, UNT `12`. No line breaks.                                                                                                                                                                                                                                                                                              |
| `contrl-accepting-interchange.edi`        | [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), pages 12 to 14 and 21 (example 1) | Acknowledges `orders-without-una.edi`: UCI copies its control reference `88776655`, sender `7350000001266` and receiver `7300015200048`. UCI action `7` instead of `8`, so the Interchange is acknowledged after the syntax check, not only received. UNA, UNB and UNZ added: UNB swaps the sender and receiver of the base, with control reference `C0000001`. LF after each segment.                                                                                                                                                                                                                             |
| `contrl-rejecting-message.edi`            | [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), pages 12 to 18 and 21 (example 2) | Acknowledges `invalid/invoic-with-too-long-invoice-number.edi`: UCI copies `654321`, `7300015200048` and `7350000001266`, UCM copies the message reference `14245` and the identifier `INVOIC:D:96A:UN:EAN009`. UCI action `7` instead of `8`: page 3 uses `8` only to acknowledge the Interchange without reporting on its Messages (no segment group 1), and requires the levels above a reported level to be acknowledged. `UCS+3+13` (segment 3 missing) replaced by `UCS+2` and `UCD+39+2`: element 2 of BGM, segment 2 of the base Message, is too long. UNT `6`. UNB and UNZ added. No UNA, no line breaks. |
| `contrl-rejecting-interchange.edi`        | [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), pages 12 to 14 and 21 (example 1) | UCI action `6` (UNB/UNZ rejected). Acknowledges `broken/interchange-reference-mismatch.edi`: UCI copies `CTL00021`, `4012345000016` and `5412345000013`, and reports syntax error `28` (references do not match) in element 2 of UNZ. UNB and UNZ added. Delimiters of the base: `UNA\|^,! ~`. No line breaks.                                                                                                                                                                                                                                                                                                     |

The GS1 Germany CCG recommendations for EANCOM 1997 ([ORDERS](https://events.gs1.de/common/downloads/gs1_tech/2075_1997_orders.pdf), [DESADV](https://events.gs1.de/common/downloads/gs1_tech/2071_1997_desadv.pdf), [INVOIC](https://events.gs1.de/common/downloads/gs1_tech/2072_1997_invoic.pdf), section 9) give full message examples without UNA, UNB or UNZ, so they are not the base.

## ORDERS definition

`src/definitions/orders.ts` is the UN D.96A ORDERS segment table, adjusted to EANCOM 1997 values where a public GS1 source gives them. This deviates from the ticket, which asks for the EANCOM D.96A ORDERS definition. The full EANCOM 1997 table is only in the licensed EANCOM manual.

The UN D.96A table comes from the copy of ["UN/EDIFACT D96A Message ORDERS - Purchase order message"](https://www.stylusstudio.com/edifact/D96A/ORDERS.htm) on stylusstudio.com, because unece.org was not reachable.

The public EANCOM source is the [GS1 Germany CCG recommendation for EANCOM 1997 ORDERS](https://events.gs1.de/common/downloads/gs1_tech/2075_1997_orders.pdf), section 3, printed pages 8 and 9 (PDF pages 9 and 10). It lists only the segments of the CCG Food/Nonfood profile. Each of them has the same status and maximum repetitions in `orders.ts`. Each segment group starts with its trigger segment at `M 1`.

| Entry                   | Status and maximum repetitions | Printed page |
| ----------------------- | ------------------------------ | ------------ |
| BGM                     | M 1                            | 8            |
| DTM (header)            | M 35                           | 8            |
| ALI (header)            | C 5                            | 8            |
| Segment group 1 (RFF)   | C 10                           | 8            |
| Segment group 2 (NAD)   | C 99                           | 8            |
| Segment group 3 (RFF)   | C 10                           | 8            |
| Segment group 5 (CTA)   | C 5                            | 8            |
| COM in segment group 5  | C 5                            | 8            |
| Segment group 7 (CUX)   | C 5                            | 8            |
| Segment group 8 (PAT)   | C 10                           | 8            |
| DTM in segment group 8  | C 5                            | 8            |
| Segment group 25 (LIN)  | C 200000                       | 8            |
| PIA in segment group 25 | C 25                           | 8            |
| IMD in segment group 25 | C 99                           | 8            |
| MEA in segment group 25 | C 5                            | 8            |
| QTY in segment group 25 | C 10                           | 8            |
| DTM in segment group 25 | C 35                           | 8            |
| Segment group 28 (PRI)  | C 25                           | 8            |
| Segment group 29 (RFF)  | C 10                           | 8            |
| Segment group 30 (PAC)  | C 10                           | 8            |
| Segment group 32 (PCI)  | C 5                            | 8            |
| Segment group 39 (ALC)  | C 99                           | 9            |
| Segment group 41 (PCD)  | C 1                            | 9            |
| Segment group 42 (MOA)  | C 2                            | 9            |
| UNS                     | M 1                            | 9            |
| CNT                     | C 10                           | 9            |

One CCG value differs from UN D.96A: segment group 25 (LIN) is `C 20000` in UN D.96A and `C 200000` in the CCG recommendation. Every other entry in the table matches UN D.96A, and every other entry in `orders.ts` keeps its UN D.96A value. Known gap: EANCOM drops some segments and segment groups that UN D.96A allows, and the CCG profile does not show which. Validation of an outbound Message therefore does not flag such a segment.

## INVOIC definition

`src/definitions/invoic.ts` is the UN D.96A INVOIC segment table, adjusted to EANCOM 1997 values where a public GS1 source gives them, in the same way as the ORDERS definition.

The UN D.96A table comes from the copy of ["UN/EDIFACT D96A Message INVOIC - Invoice message"](https://www.stylusstudio.com/edifact/D96A/INVOIC.htm) on stylusstudio.com. It is a one-off scripted transcription of the segment table on that page, spot-checked against it.

The public EANCOM source is the [GS1 Germany CCG recommendation for EANCOM 1997 INVOIC](https://events.gs1.de/common/downloads/gs1_tech/2072_1997_invoic.pdf), section 3, printed pages 13 to 15 (PDF pages 14 to 16). It lists only the segments of the CCG profile. Each of them has the same status and maximum repetitions in `invoic.ts`. Each segment group starts with its trigger segment at `M 1`.

| Entry                   | Status and maximum repetitions | Printed page |
| ----------------------- | ------------------------------ | ------------ |
| BGM                     | M 1                            | 13           |
| DTM (header)            | M 35                           | 13           |
| PAI (header)            | C 1                            | 13           |
| ALI (header)            | C 5                            | 13           |
| FTX (header)            | C 10                           | 13           |
| Segment group 1 (RFF)   | C 99                           | 13           |
| DTM in segment group 1  | C 5                            | 13           |
| Segment group 2 (NAD)   | C 99                           | 13           |
| Segment group 3 (RFF)   | C 9999                         | 13           |
| Segment group 5 (CTA)   | C 5                            | 13           |
| Segment group 6 (TAX)   | C 5                            | 13           |
| Segment group 7 (CUX)   | C 5                            | 13           |
| Segment group 8 (PAT)   | C 10                           | 13           |
| DTM in segment group 8  | C 5                            | 13           |
| PCD in segment group 8  | C 1                            | 13           |
| MOA in segment group 8  | C 1                            | 13           |
| Segment group 15 (ALC)  | C 9999                         | 13           |
| Segment group 17 (QTY)  | C 1                            | 13           |
| Segment group 18 (PCD)  | C 1                            | 13           |
| Segment group 19 (MOA)  | C 2                            | 13           |
| Segment group 21 (TAX)  | C 5                            | 13           |
| Segment group 25 (LIN)  | C 9999999                      | 14           |
| PIA in segment group 25 | C 25                           | 14           |
| IMD in segment group 25 | C 10                           | 14           |
| MEA in segment group 25 | C 5                            | 14           |
| QTY in segment group 25 | C 5                            | 14           |
| ALI in segment group 25 | C 5                            | 14           |
| FTX in segment group 25 | C 5                            | 14           |
| Segment group 26 (MOA)  | C 5                            | 14           |
| Segment group 28 (PRI)  | C 25                           | 14           |
| Segment group 29 (RFF)  | C 10                           | 14           |
| DTM in segment group 29 | C 5                            | 14           |
| Segment group 30 (PAC)  | C 10                           | 14           |
| MEA in segment group 30 | C 10                           | 14           |
| Segment group 33 (TAX)  | C 99                           | 14           |
| Segment group 38 (ALC)  | C 15                           | 14           |
| Segment group 39 (QTY)  | C 1                            | 14           |
| Segment group 40 (PCD)  | C 1                            | 14           |
| Segment group 41 (MOA)  | C 2                            | 14           |
| Segment group 42 (RTE)  | C 1                            | 14           |
| UNS                     | M 1                            | 14           |
| Segment group 48 (MOA)  | M 100                          | 14           |
| Segment group 50 (TAX)  | C 10                           | 15           |
| MOA in segment group 50 | C 2                            | 15           |

One CCG value differs from UN D.96A: segment group 25 (LIN) is `C 99999` in UN D.96A and `C 9999999` in the CCG recommendation. Every other entry in the table matches UN D.96A, and every other entry in `invoic.ts` keeps its UN D.96A value. Segment group 48 (MOA) is `M 100` in both, so an INVOIC message without a total amount is invalid. The same known gap as for ORDERS applies: validation of an outbound Message does not flag a segment that EANCOM drops but UN D.96A allows.

## DESADV definition

`src/definitions/desadv.ts` is the UN D.96A DESADV segment table, adjusted to EANCOM 1997 values where a public GS1 source gives them, in the same way as the ORDERS definition.

The UN D.96A table comes from the copy of ["UN/EDIFACT D96A Message DESADV - Despatch advice message"](https://www.stylusstudio.com/edifact/D96A/DESADV.htm) on stylusstudio.com. It is a transcription of the segment table on that page, compared entry by entry against it with a one-off script.

The public EANCOM source is the [GS1 Germany CCG recommendation for EANCOM 1997 DESADV](https://events.gs1.de/common/downloads/gs1_tech/2071_1997_desadv.pdf), section 3, printed pages 17 and 18 (PDF pages 18 and 19). It lists only the segments of the CCG Food/Nonfood profile. Each of them has the same status and maximum repetitions in `desadv.ts`. Each segment group starts with its trigger segment at `M 1`.

| Entry                   | Status and maximum repetitions | Printed page |
| ----------------------- | ------------------------------ | ------------ |
| BGM                     | M 1                            | 17           |
| DTM (header)            | C 10                           | 17           |
| Segment group 1 (RFF)   | C 10                           | 17           |
| DTM in segment group 1  | C 1                            | 17           |
| Segment group 2 (NAD)   | C 10                           | 17           |
| Segment group 3 (RFF)   | C 10                           | 17           |
| Segment group 4 (CTA)   | C 10                           | 17           |
| Segment group 8 (EQD)   | C 10                           | 17           |
| MEA in segment group 8  | C 5                            | 17           |
| SEL in segment group 8  | C 25                           | 17           |
| Segment group 10 (CPS)  | C 9999                         | 17           |
| Segment group 11 (PAC)  | C 9999                         | 17           |
| MEA in segment group 11 | C 10                           | 17           |
| Segment group 13 (PCI)  | C 1000                         | 17           |
| Segment group 14 (GIN)  | C 99                           | 17           |
| Segment group 15 (LIN)  | C 9999                         | 17           |
| PIA in segment group 15 | C 10                           | 17           |
| IMD in segment group 15 | C 25                           | 17           |
| MEA in segment group 15 | C 10                           | 17           |
| QTY in segment group 15 | C 10                           | 17           |
| Segment group 16 (RFF)  | C 10                           | 17           |
| Segment group 20 (PCI)  | C 9999                         | 17           |
| DTM in segment group 20 | C 5                            | 18           |
| Segment group 21 (GIN)  | C 10                           | 18           |
| Segment group 23 (QVR)  | C 10                           | 18           |
| CNT                     | C 5                            | 18           |

Every entry in the table matches UN D.96A, so `desadv.ts` keeps the UN D.96A values throughout. DESADV has no UNS. The header DTM is `C 10` in both, so a DESADV message without a date is valid. The same known gap as for ORDERS applies: validation of an outbound Message does not flag a segment that EANCOM drops but UN D.96A allows, such as TDT in segment group 6, which `desadv-with-una.edi` uses.

## CONTRL definition

`src/definitions/contrl.ts` is the CONTRL segment table of the GS1 manual [EANCOM 2002 S3 CONTRL, Syntax and service report message](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), edition 2016, update 2021: message structure chart on page 5, branching diagram on page 6 and segment descriptions on page 7. The manual is EANCOM subset version 004 of CONTRL, based on syntax version 3. Validation accepts CONTRL as `CONTRL:D:3:UN` only.

| Entry                  | Status and maximum repetitions | Page |
| ---------------------- | ------------------------------ | ---- |
| UCI                    | M 1                            | 5    |
| Segment group 1 (UCM)  | C 999999                       | 5    |
| Segment group 2 (UCS)  | C 999                          | 5    |
| UCD in segment group 2 | C 99                           | 5    |

The table is compared with the UN syntax version 3 CONTRL table on stylusstudio.com, ["UN/EDIFACT 30000 Message CONTRL"](https://www.stylusstudio.com/edifact/30000/CONTRL.htm). Part of that table is corrupt. Each difference, and the value `contrl.ts` keeps:

| Entry                                     | Manual           | stylusstudio.com | Kept                                                                                                                                         |
| ----------------------------------------- | ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| UCM in segment group 1                    | M 1              | M 0              | M 1. A maximum of 0 is not a valid repetition count.                                                                                         |
| Segment group 3 (UCF) with groups 4 and 5 | not in the table | C 999999         | Dropped. EANCOM does not use CONTRL to report on functional groups (page 2).                                                                 |
| Segment groups 4 and 5, UCD in group 5    | not in the table | C 999, C 99, M 1 | Dropped with segment group 3. They mirror segment groups 1 and 2 (`C 999999`, `C 999`, UCD `C 99`), with the repetitions shifted by one row. |

UCI, segment group 1, segment group 2, UCS and UCD in segment group 2 have the same values in both. The stylusstudio.com page of syntax version 4 ([40100](https://www.stylusstudio.com/edifact/40100/CONTRL.htm)) shows the same corrupt rows.

The manual is EANCOM 2002, while the ORDERS, DESADV and INVOIC definitions follow EANCOM 1997. CONTRL is defined in the syntax version 3 service directory, not in the D.96A or D.01B message directory, so its segment table and data elements are the same in both EANCOM editions. The editions differ in these points:

- UNH identifies the manual's CONTRL as `CONTRL:D:3:UN:EAN004` (page 12). [MS 11 Syntaxkvittens](https://gs1.se/wp-content/uploads/sites/2/2020/07/ms11_se200-1.pdf) for EANCOM 1997 gives association code `EAN002`. The identifier match compares the message type, version, release and controlling agency, and ignores the association code, so both are accepted.
- MS 11 identifies its CONTRL as `CONTRL:D:96A:EN:EAN002`. Validation rejects that identifier with `unsupported-message-type`, as `invalid/contrl-of-unsupported-directory.edi` shows.
- The manual adds GS1 codes to the service code lists 0083 and 0085, listed in [Code lists](#code-lists). An EANCOM 1997 partner may not send them.
- The UCM example of the manual (page 16) acknowledges an `INVOIC:D:01B:UN:EAN010` Message of EANCOM 2002. The CONTRL golden files acknowledge the D.96A Interchanges of this directory.

## Segment definitions

`src/definitions/segments.ts`, `composites.ts` and `data-elements.ts` hold the data elements and composites of each segment in the ORDERS, INVOIC, DESADV and CONTRL definitions: their order, status (`M` or `C`) and format (`a`, `n` or `an`, with the maximum length). The ORDERS, INVOIC and DESADV segments come from the UN D.96A segment pages on stylusstudio.com, linked from the ORDERS, INVOIC and DESADV pages above (for example [BGM](https://www.stylusstudio.com/edifact/D96A/BGM_.htm), [AJT](https://www.stylusstudio.com/edifact/D96A/AJT_.htm) and [CPS](https://www.stylusstudio.com/edifact/D96A/CPS_.htm)). UNS comes from the [UNS page](https://www.stylusstudio.com/edifact/40100/UNS_.htm) of the syntax directory that the ORDERS page links.

The definitions in these files and in `code-lists.ts` are a one-off scripted transcription of the UN D.96A segment, composite, data element and code list pages on stylusstudio.com, spot-checked against those pages. The script is not part of the repository. Two checks are independent of the transcription: every segment example in section 9 of the CCG recommendation for EANCOM 1997 ORDERS and in MS30 Order passes validation, and the invalid golden files are written by hand. For INVOIC, every segment example in section 9 of the CCG recommendation for EANCOM 1997 INVOIC and in [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf) passes the element checks, and the section 9 example passes as one Message, with two exceptions. Both break a limit their own source gives:

- The first LIN of the CCG example has 12 IMD segments. Section 3 of the same recommendation allows 10 (printed page 14), so the example passes only without two of them.
- The FTX example on MS35 page 10 holds about 130 characters in data element 4440, which MS35 gives as `an..70`. The INVOIC golden files split this text into two components.

For DESADV, every segment example in section 9 of the CCG recommendation for EANCOM 1997 DESADV and in [MS34 Leveransavisering](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms34_desadv_se-1.pdf) passes the element checks. The section 9 example passes as one Message once its UNT count is corrected: it gives `88`, but the example has 90 segments from UNH to UNT.

The CONTRL segments are the service segments UCI, UCM, UCS and UCD, with the composites S002, S003, S009 and S011 and the 0xxx data elements. They come from the syntax version 3 segment pages on stylusstudio.com ([UCI](https://www.stylusstudio.com/edifact/30000/UCI_.htm), [UCM](https://www.stylusstudio.com/edifact/30000/UCM_.htm), [UCS](https://www.stylusstudio.com/edifact/30000/UCS_.htm) and [UCD](https://www.stylusstudio.com/edifact/30000/UCD_.htm)). S002, S003 and S009 are the syntax version 3 composites, which UNB and UNH also use; validation does not check UNB or UNH against them. UCF and its composites S006 and S007 are not defined, because the EANCOM CONTRL has no segment group 3 (see [CONTRL definition](#contrl-definition)).

Every data element of UCI, UCM, UCS and UCD in the [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf) manual (pages 13 to 18) has the same position, status and format as on the stylusstudio.com pages. The manual narrows them for EANCOM in these points:

- The manual adds GS1 codes to 0083 in UCI and to 0085 in UCI, UCM, UCS and UCD. Validation accepts them, listed in [Code lists](#code-lists).
- The manual restricts 0085 to a different subset in each of UCI, UCM, UCS and UCD, and lists only `4` and `7` for 0083 in UCM. Each data element has one code list for every segment, so validation accepts each code of the full list in every segment. Known gap: a UCM with action `6` or `8` passes.
- The manual marks 0057 in UCM as required (`R`) and 0007 in UCI as optional (`O`). These are EANCOM statuses of conditional data elements. The definitions keep the UN status `C`.
- The manual gives 0004 and 0010 as a GLN (`n13`). The definitions keep the UN format `an..35`, as for AT 0.1.1 and AT 0.1.2 below.

The GS1 Sweden sources for CONTRL are [MS 11 Syntaxkvittens](https://gs1.se/wp-content/uploads/sites/2/2020/07/ms11_se200-1.pdf), [AT 0.1.1 Överföringskvittens](https://gs1.se/wp-content/uploads/sites/2/2020/07/at000101_se200-1.pdf) and [AT 0.1.2 Meddelandekvittens](https://gs1.se/wp-content/uploads/sites/2/2020/07/at000102_se200-1.pdf), all version 2.00 of 1999-01-25. They use UCI and UCM only. Every data element they list in UCI and UCM has the same position, format and status as on the stylusstudio.com pages, with these differences:

- MS 11 makes 0007 in S002 and S003 mandatory with the value `14` (EAN). UN syntax version 3 has 0007 conditional, and the definitions keep that.
- AT 0.1.1 and AT 0.1.2 give 0004 and 0010 as `n13`, an EAN location number. This restricts the UN format `an..35`, which the definitions keep.
- AT 0.1.1 gives code `6` (interchange rejected) for 0083. The syntax version 3 code list 0083 has no code `6`; code `4` rejects a level and all lower levels. The EANCOM 2002 manual lists `6` in UCI as a GS1 permanent code, "UNB/UNZ rejected" (page 13). Validation accepts `6` as an EANCOM addition, listed in [Code lists](#code-lists).
- MS 11 identifies the Message as `CONTRL:D:96A:EN:EAN002`, which validation does not support (see [CONTRL definition](#contrl-definition)).

A value after the last data element of a segment or after the last component of an element is unexpected. Empty values there are allowed.

A numeric (`n`) value holds digits, an optional leading minus sign and at most one decimal mark of the Interchange, with a digit on each side. Its length counts the digits only. This follows ISO 9735, where the sign and the decimal mark do not count toward the length; no fetched source confirms it.

### Code lists

`src/definitions/code-lists.ts` holds a code list for each coded data element that the segment pages link to a UN D.96A code list, such as [1225](https://www.stylusstudio.com/edifact/D96A/1225.htm), and for 0081 from the [syntax directory](https://www.stylusstudio.com/edifact/40100/0081.htm). The data elements of the CONTRL service segments take their code lists from the syntax version 3 service code lists on stylusstudio.com, revision 2003B: [0007](https://www.stylusstudio.com/edifact/30000/0007.htm), [0013](https://www.stylusstudio.com/edifact/30000/0013.htm), [0051](https://www.stylusstudio.com/edifact/30000/0051.htm), [0052](https://www.stylusstudio.com/edifact/30000/0052.htm), [0054](https://www.stylusstudio.com/edifact/30000/0054.htm), [0065](https://www.stylusstudio.com/edifact/30000/0065.htm), [0083](https://www.stylusstudio.com/edifact/30000/0083.htm) and [0085](https://www.stylusstudio.com/edifact/30000/0085.htm). Codes marked for deletion stay in the list, because D.96A still allows them. Data elements without a linked code list, such as 6345 (currency), 3207 (country) and 6411 (unit of measure), take any value of their format.

EANCOM adds codes to some UN code lists. The table lists each added code that a public GS1 source uses in an ORDERS, DESADV, INVOIC or CONTRL message. Each data element has one code list for every Message Type, so a code added for INVOIC is also accepted in ORDERS. The CCG source for ORDERS is section 8 of the CCG recommendation for EANCOM 1997 ORDERS linked above. The CCG INVOIC source is the recommendation for EANCOM 1997 INVOIC linked above, sections 7 and 8. The CCG DESADV source is section 8 of the recommendation for EANCOM 1997 DESADV linked above. The CONTRL manual marks its added codes as GS1 temporary or permanent codes. Known gap: EANCOM also restricts the UN code lists, and the full restrictions are only in the licensed EANCOM manual. Validation therefore accepts every UN D.96A code.

| Data element | Added codes       | Source                                                                                                         |
| ------------ | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| 0083         | `6`               | [AT 0.1.1 Överföringskvittens](https://gs1.se/wp-content/uploads/sites/2/2020/07/at000101_se200-1.pdf), page 1 |
| 0083         | `6`               | [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), page 13            |
| 0085         | `1` `11`          | [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), page 13            |
| 0085         | `3`               | [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), page 15            |
| 0085         | `6`               | [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), page 17            |
| 0085         | `9`               | [EANCOM 2002 S3 CONTRL](https://www.gs1.org/sites/default/files/docs/eancom/s3/contrl.pdf), page 18            |
| 1001         | `22E` `23B` `50E` | CCG ORDERS, printed page 160                                                                                   |
| 1001         | `YA5` `YA6` `YA7` | CCG DESADV, printed page 216                                                                                   |
| 1131         | `SKB`             | CCG ORDERS, printed page 160                                                                                   |
| 1131         | `997` `E`         | CCG INVOIC, printed page 244                                                                                   |
| 1153         | `API`             | CCG ORDERS, printed page 160                                                                                   |
| 1153         | `CDN` `PDR`       | CCG INVOIC, printed page 427                                                                                   |
| 1153         | `ASH`             | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), page 3                   |
| 3035         | `DGB`             | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), page 4                     |
| 3035         | `LSP`             | CCG DESADV, printed page 217                                                                                   |
| 3035         | `DEQ`             | [MS34 Leveransavisering](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms34_desadv_se-1.pdf), page 2       |
| 3055         | `246`             | CCG ORDERS, printed page 161                                                                                   |
| 3055         | `9SE`             | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), pages 2 and 10           |
| 4183         | `X5`              | CCG ORDERS, printed page 162                                                                                   |
| 4183         | `60E`             | CCG INVOIC, printed page 430                                                                                   |
| 4183         | `140`             | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), pages 2 and 10           |
| 4233         | `33E`             | CCG DESADV, printed page 218                                                                                   |
| 4233         | `39`              | [MS34 Leveransavisering](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms34_desadv_se-1.pdf), page 4       |
| 4451         | `BAQ`             | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), pages 2 and 10           |
| 5025         | `11E` `XB5`       | CCG INVOIC, printed page 431                                                                                   |
| 5125         | `1E`              | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), page 11                  |
| 5305         | `M`               | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), page 13                  |
| 5387         | `LIU`             | CCG ORDERS, printed page 162                                                                                   |
| 6063         | `45E`             | CCG INVOIC, printed page 433                                                                                   |
| 6313         | `LAY` `ULY`       | CCG ORDERS, printed page 162                                                                                   |
| 6343         | `18`              | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), page 5                   |
| 7073         | `LAB`             | CCG ORDERS, printed page 163                                                                                   |
| 7081         | `SGR`             | CCG ORDERS, printed page 163                                                                                   |
| 7143         | `EWC`             | CCG ORDERS, printed page 163                                                                                   |
| 7143         | `SRV`             | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), page 4                     |
| 7405         | `SRV`             | [MS34 Leveransavisering](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms34_desadv_se-1.pdf), page 4       |

In the CCG recommendation for INVOIC, data element 1131 in FTX carries a reporting code of the Deutsche Bundesbank, with `997` and `E` given as examples. Known gap: other codes of that list fail validation.

## Invalid Interchanges

Each file in `invalid/` parses without an error and fails validation. The expected `.json` file holds the code and position of the `ValidationError`, written by hand. Each file is a valid ORDERS, DESADV, INVOIC or CONTRL golden file with one change. A change to the segment structure of ORDERS breaks a limit from the CCG table in [ORDERS definition](#orders-definition): BGM `M 1`, header DTM `M 35` before segment group 2, segment group 7 `C 5` or UNS `M 1`. A change to the segment structure of INVOIC breaks a limit or the order from the CCG table in [INVOIC definition](#invoic-definition): header ALI `C 5`, segment group 48 `M 100`, or segment group 28 (PRI) inside segment group 25 (LIN). A change to the segment structure of DESADV breaks a limit or the order from the CCG table in [DESADV definition](#desadv-definition): BGM `M 1`, header DTM `C 10`, or segment group 15 (LIN) inside segment group 10 (CPS). A change to the segment structure of CONTRL breaks a limit or the order from the table in [CONTRL definition](#contrl-definition): UCI `M 1`, or UCD inside segment group 2 (UCS). A change to an element breaks a rule from [Segment definitions](#segment-definitions).

| Golden file                                                      | Base                                 | Change                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders-without-beginning-of-message.edi`                        | `orders-without-una.edi`             | BGM removed, UNT `13`.                                                                                                                        |
| `orders-with-repeated-beginning-of-message.edi`                  | `orders-without-una.edi`             | BGM repeated, UNT `15`.                                                                                                                       |
| `orders-with-too-many-currency-groups.edi`                       | `orders-without-una.edi`             | Six `CUX+2:SEK:9` after the last NAD; segment group 7 allows five. UNT `20`.                                                                  |
| `orders-without-section-control.edi`                             | `orders-without-una.edi`             | UNS removed, UNT `13`.                                                                                                                        |
| `orders-of-unsupported-directory.edi`                            | `orders-without-una.edi`             | UNH identifies `ORDERS:D:01B:UN:EAN010`.                                                                                                      |
| `orders-with-misplaced-date-in-second-message.edi`               | `orders-with-multiple-messages.edi`  | Message 2: `DTM+2:20221201:102` after the last NAD, UNT `11`.                                                                                 |
| `orders-with-too-long-order-number.edi`                          | `orders-without-una.edi`             | BGM order number with 36 characters; data element 1004 allows `an..35`.                                                                       |
| `orders-without-party-qualifier.edi`                             | `orders-without-una.edi`             | First NAD without its party qualifier: `NAD++7300015200000::9`. Data element 3035 is `M`.                                                     |
| `orders-without-ordered-quantity.edi`                            | `orders-without-una.edi`             | QTY without its quantity: `QTY+21::GRM`. Data element 6060 is `M` in composite C186.                                                          |
| `orders-with-unit-in-quantity.edi`                               | `orders-without-una.edi`             | QTY with a unit in its quantity: `QTY+21:2000kg:GRM`. Data element 6060 is `n..15`.                                                           |
| `orders-with-unknown-date-format.edi`                            | `orders-without-una.edi`             | First DTM with date format `104`: `DTM+137:20221125:104`. The code list of data element 2379 has no `104`.                                    |
| `orders-with-extra-element-in-control-total.edi`                 | `orders-without-una.edi`             | Last CNT with a second element: `CNT+2:1+5`. CNT has one element.                                                                             |
| `orders-with-extra-component-in-item-number.edi`                 | `orders-without-una.edi`             | PIA with a fifth component in its item number: `PIA+1+1254:SA::9:5`. Composite C212 has four components.                                      |
| `invoic-with-too-many-additional-information.edi`                | `invoic-with-release-characters.edi` | Six `ALI+++140` after the last header DTM; the header allows five ALI. UNT `27`.                                                              |
| `invoic-without-total-amount.edi`                                | `invoic-with-release-characters.edi` | Both MOA after CNT removed, so segment group 48 is missing. UNT `19`.                                                                         |
| `invoic-with-price-before-line-item.edi`                         | `invoic-with-release-characters.edi` | PRI moved before LIN, out of segment group 25.                                                                                                |
| `invoic-without-payment-terms-type.edi`                          | `invoic-with-release-characters.edi` | PAT without its type: `PAT+++66:1`. Data element 4279 is `M`.                                                                                 |
| `invoic-with-too-long-invoice-number.edi`                        | `invoic-with-release-characters.edi` | BGM invoice number with 36 characters; data element 1004 allows `an..35`.                                                                     |
| `invoic-with-currency-in-amount.edi`                             | `invoic-with-release-characters.edi` | Last MOA with a currency in its amount: `MOA+79:54150SEK`. Data element 5004 is `n..18`.                                                      |
| `invoic-with-decimal-point-under-decimal-comma.edi`              | `invoic-with-custom-delimiters.edi`  | PRI with a decimal point: `36.1`. The UNA sets the decimal comma.                                                                             |
| `invoic-with-unknown-document-type.edi`                          | `invoic-with-release-characters.edi` | BGM with document type `999`. The code list of data element 1001 has no `999`.                                                                |
| `invoic-with-extra-component-in-quantity.edi`                    | `invoic-with-release-characters.edi` | QTY with a fourth component: `QTY+47:1500:GRM:9`. Composite C186 has three components.                                                        |
| `invoic-with-unknown-adjustment-reason.edi`                      | `invoic-with-release-characters.edi` | `AJT+99` added after the DTM of segment group 8. The code list of data element 4465 has no `99`. UNT `22`.                                    |
| `invoic-without-instruction-party.edi`                           | `invoic-with-release-characters.edi` | `INP+:2` added after the DTM of segment group 8. Data element 3301 is `M` in composite C849. UNT `22`.                                        |
| `desadv-without-beginning-of-message.edi`                        | `desadv-with-una.edi`                | BGM removed, UNT `20`.                                                                                                                        |
| `desadv-with-too-many-dates.edi`                                 | `desadv-with-una.edi`                | Eight `DTM+11:202212010610:203` after the last header DTM; the header allows ten DTM. UNT `29`.                                               |
| `desadv-with-line-item-before-packing-sequence.edi`              | `desadv-with-una.edi`                | LIN moved before the first CPS, out of segment group 10.                                                                                      |
| `desadv-of-unsupported-directory.edi`                            | `desadv-with-una.edi`                | UNH identifies `DESADV:D:01B:UN:EAN007`.                                                                                                      |
| `desadv-without-hierarchical-id.edi`                             | `desadv-with-una.edi`                | Second CPS without its hierarchical ID: `CPS++1`. Data element 7164 is `M`.                                                                   |
| `desadv-with-too-long-hierarchical-id.edi`                       | `desadv-with-una.edi`                | First CPS with a hierarchical ID of 13 characters: `CPS+1234567890123`. Data element 7164 allows `an..12`.                                    |
| `desadv-with-unit-in-measurement.edi`                            | `desadv-with-una.edi`                | MEA with a unit in its measurement value: `MEA+PD+AAD+KGM:500kg`. Data element 6314 is `n..18`.                                               |
| `desadv-with-unknown-packaging-level.edi`                        | `desadv-with-una.edi`                | Second CPS with packaging level `5`: `CPS+2+1+5`. The code list of data element 7075 has no `5`.                                              |
| `desadv-with-extra-component-in-identity-number-range.edi`       | `desadv-with-una.edi`                | GIN with a third component in its identity number range: `GIN+BJ+373000152000023055:373000152000023056:1`. Composite C208 has two components. |
| `contrl-without-interchange-response.edi`                        | `contrl-accepting-interchange.edi`   | UCI removed, UNT `2`.                                                                                                                         |
| `contrl-with-repeated-interchange-response.edi`                  | `contrl-accepting-interchange.edi`   | UCI repeated, UNT `4`.                                                                                                                        |
| `contrl-of-unsupported-directory.edi`                            | `contrl-accepting-interchange.edi`   | UNH identifies `CONTRL:D:96A:EN:EAN002`, the identifier of MS 11.                                                                             |
| `contrl-without-action.edi`                                      | `contrl-accepting-interchange.edi`   | UCI without its action: `UCI+88776655+7350000001266:14+7300015200048:14`. Data element 0083 is `M`.                                           |
| `contrl-with-too-long-control-reference.edi`                     | `contrl-accepting-interchange.edi`   | UCI control reference with 15 characters: `887766551234567`. Data element 0020 allows `an..14`.                                               |
| `contrl-with-unknown-action.edi`                                 | `contrl-accepting-interchange.edi`   | UCI with action `5`. The code list of data element 0083 has no `5`.                                                                           |
| `contrl-with-segment-tag-as-segment-position.edi`                | `contrl-rejecting-message.edi`       | UCS with a segment tag as its position: `UCS+BGM`. Data element 0096 is `n..6`.                                                               |
| `contrl-with-data-element-error-without-segment-error.edi`       | `contrl-rejecting-message.edi`       | UCS removed, so UCD follows UCM outside segment group 2. UNT `5`.                                                                             |
| `contrl-with-extra-component-in-data-element-identification.edi` | `contrl-rejecting-message.edi`       | UCD with a third component in its data element identification: `UCD+39+2:1:1`. Composite S011 has two.                                        |
