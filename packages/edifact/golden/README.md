# Golden files

Each valid Interchange is a subset of the segment examples ("Exempel") in a GS1 Sweden ESAP 20 mapping specification for EANCOM 1997 (D.96A), version 1.8.0, 2023-05-29. The source lists alternative segments side by side, so its own UNT count does not match its examples. Each file keeps one coherent alternative per segment in message order, with the example values unchanged, and sets UNT to the segments it keeps.

The expected `.json` files are written by hand from the `.edi` files, never from parse output. The test reads both as ISO 8859-1 (UNOC): non-ASCII characters are single Latin-1 bytes in the `.edi` files and `\u` escapes in the `.json` files.

| Golden file                               | Source                                                                                                         | Deviations                                                                                                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orders-without-una.edi`                  | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), pages 1 to 5               | UNA dropped. 14 of the 29 examples from UNH to UNT, UNT `14` instead of `24`. No line breaks.                                                                                                                                                  |
| `orders-with-multiple-messages.edi`       | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), pages 1 to 5               | CRLF after each segment. Message 1: 14 of the 29 examples, UNT `14`. Message 2 is added: a smaller subset with message reference `234568` and order number `73000152012297655`, UNT `10`. UNZ counts `2` Messages.                             |
| `orders-with-mixed-line-breaks.edi`       | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), pages 1 to 5               | The segments of `orders-without-una.edi` with UNA `UNA:+.? '` added. The gaps mix LF, CRLF, CR and no line break, and CRLF follows the last segment.                                                                                           |
| `orders-without-una-with-blank-lines.edi` | [MS30 Order](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms30_orders_se.pdf), pages 1 to 5               | The segments of `orders-without-una.edi`. CRLF before UNB. The gaps hold runs of CR and LF characters, blank lines included, and two CRLF follow the last segment.                                                                             |
| `desadv-with-una.edi`                     | [MS34 Leveransavisering](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms34_desadv_se-1.pdf), pages 1 to 7 | LF after each segment. 21 of the 40 examples from UNH to UNT, UNT `21` instead of `35`.                                                                                                                                                        |
| `invoic-with-release-characters.edi`      | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), pages 1 to 13            | LF after each segment. 21 of the 82 examples from UNH to UNT, UNT `21` instead of `76`. The FTX free text (page 10) keeps its released colon `(1994?:200)` and its Latin-1 characters.                                                         |
| `invoic-with-custom-delimiters.edi`       | [MS35 Faktura](https://gs1.se/wp-content/uploads/sites/2/2023/05/ms35_invoic_se.pdf), pages 1 to 13            | UNA changed to `UNA\|^,! ~` and every delimiter replaced to match. PRI uses the decimal comma (`36,1`). The colon in `(1994:200)` is plain text under these delimiters, so it has no release. 12 of the 82 examples, UNT `12`. No line breaks. |

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

## Segment definitions

`src/definitions/segments.ts`, `composites.ts` and `data-elements.ts` hold the data elements and composites of each segment in the ORDERS definition: their order, status (`M` or `C`) and format (`a`, `n` or `an`, with the maximum length). They come from the UN D.96A segment pages on stylusstudio.com, linked from the ORDERS page above (for example [BGM](https://www.stylusstudio.com/edifact/D96A/BGM_.htm)). UNS comes from the [UNS page](https://www.stylusstudio.com/edifact/40100/UNS_.htm) of the syntax directory that the ORDERS page links.

A numeric (`n`) value holds digits, an optional leading minus sign and at most one decimal mark of the Interchange, with a digit on each side. Its length counts the digits only.

## Invalid Interchanges

Each file in `invalid/` parses without an error and fails validation. The expected `.json` file holds the code and position of the `ValidationError`, written by hand. Each file is a valid ORDERS golden file with one change. A change to the segment structure breaks a limit from the CCG table in [ORDERS definition](#orders-definition): BGM `M 1`, header DTM `M 35` before segment group 2, segment group 7 `C 5` or UNS `M 1`. A change to an element breaks a rule from [Segment definitions](#segment-definitions).

| Golden file                                        | Base                                | Change                                                                                    |
| -------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `orders-without-beginning-of-message.edi`          | `orders-without-una.edi`            | BGM removed, UNT `13`.                                                                    |
| `orders-with-repeated-beginning-of-message.edi`    | `orders-without-una.edi`            | BGM repeated, UNT `15`.                                                                   |
| `orders-with-too-many-currency-groups.edi`         | `orders-without-una.edi`            | Six `CUX+2:SEK:9` after the last NAD; segment group 7 allows five. UNT `20`.              |
| `orders-without-section-control.edi`               | `orders-without-una.edi`            | UNS removed, UNT `13`.                                                                    |
| `orders-of-unsupported-directory.edi`              | `orders-without-una.edi`            | UNH identifies `ORDERS:D:01B:UN:EAN010`.                                                  |
| `orders-with-misplaced-date-in-second-message.edi` | `orders-with-multiple-messages.edi` | Message 2: `DTM+2:20221201:102` after the last NAD, UNT `11`.                             |
| `orders-with-too-long-order-number.edi`            | `orders-without-una.edi`            | BGM order number with 36 characters; data element 1004 allows `an..35`.                   |
| `orders-without-party-qualifier.edi`               | `orders-without-una.edi`            | First NAD without its party qualifier: `NAD++7300015200000::9`. Data element 3035 is `M`. |
| `orders-without-ordered-quantity.edi`              | `orders-without-una.edi`            | QTY without its quantity: `QTY+21::GRM`. Data element 6060 is `M` in composite C186.      |
| `orders-with-unit-in-quantity.edi`                 | `orders-without-una.edi`            | QTY with a unit in its quantity: `QTY+21:2000kg:GRM`. Data element 6060 is `n..15`.       |
