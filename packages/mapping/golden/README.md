# Golden files

`invoic-reference.edi` is the INVOIC that the reference Mapping Version `invoic-reference.mapping.json` must produce from the reference Document `invoic-reference.document.json`. It is written by hand from the full example ("Gesamtbeispiel") of the [GS1 Germany CCG recommendation for EANCOM 1997 INVOIC](https://events.gs1.de/common/downloads/gs1_tech/2072_1997_invoic.pdf), update 2005, section 9, printed pages 438 to 449. It is never written from engine output.

The test reads the Document through its Document Structure, applies the Mapping Version and wraps the Message in the UNB and UNZ of the golden file. The Interchange must pass the `edifact` validator and serialize to the golden file byte for byte. The file is ISO 8859-1 (UNOC): `ü` is one Latin-1 byte.

## Document and Mapping Version

The Document holds the example values in the shape of an ERP export. Transforms turn them into EDIFACT values:

| Document                      | Transform                                 | Message                |
| ----------------------------- | ----------------------------------------- | ---------------------- |
| `invoiceDate`: `20.03.2000`   | date format `dd.MM.yyyy` to `yyyyMMdd`    | `DTM+137:20000320`     |
| none                          | constant `102`, into each date            | `DTM+137:20000320:102` |
| none                          | constants `380` and `9`                   | `BGM+380+87441+9`      |
| `lines[]`                     | loop into SG25, counter into LIN 1082     | `LIN+1`, `LIN+2`       |
| `lines[].unit`: `ST`          | Lookup Table `ST` to `PCE`, fallback fail | `QTY+47:11:PCE`        |
| `lines[].netAmount`: `108.13` | number format, two decimal places, `.`    | `MOA+203:108.13`       |

The other values are plain links. The single codes of the structure fill themselves, for example `S` in UNS, `VAT` in TAX and `2`, `EUR` and `4` in CUX.

## Deviations from the example

The example lists more segments than the INVOIC structure of `packages/contracts` has, and several alternatives side by side. The golden file keeps 30 of its segments between UNH and UNT, in the order of the structure, with the example values unchanged except as listed:

| Segments        | Deviation                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UNB, UNZ        | Added. The example has none. Sender is the supplier GLN `4389876511113`, recipient the buyer GLN `4071615111110`, date `000320` (the message date), time `1200`, control reference `00000001`. No UNA. LF after each segment.                                                                                                                         |
| UNH, UNT        | Message reference `1` instead of `ME000001`, because the engine numbers the Message `1`. UNT `32` instead of `179`.                                                                                                                                                                                                                                   |
| BGM, CUX, TAX   | Empty trailing components and elements are left out, as the serializer writes them: `BGM+380+87441+9` for `BGM+380:::+87441+9`, `TAX+7+VAT+++:::16` for `TAX+7+VAT:::+::++:::16:::+`. CUX keeps its first currency only: `CUX+2:EUR:4` for `CUX+2:EUR:4:+3:USD:11:+`. 5305 is empty in each TAX of the example, so the Mapping Version leaves it out. |
| DTM             | DTM+137 and DTM+35 kept. The example gives `DTM+137:20000320:102` and describes it as 02.04.1998; the value is kept.                                                                                                                                                                                                                                  |
| SG1             | RFF+ON and RFF+DQ kept, each with its `DTM+171:19980301:102`. The other references are left out.                                                                                                                                                                                                                                                      |
| SG2             | NAD+BY, NAD+SU, NAD+IV and NAD+DP kept, in the order of the structure instead of BY, IV, DP, SU. NAD+DP without name and address. RFF+VA kept after BY and SU only, since the structure has no reference group for IV. RFF+API and the other parties are left out.                                                                                    |
| SG6             | The header `TAX+7+VAT:::+::++:::16:::+` before CUX (printed page 441) is left out, since the structure has no header tax group.                                                                                                                                                                                                                       |
| SG25, line 1    | LIN+1 (printed page 442) with its first IMD+A, `QTY+47:11:PCE`, `MOA+203:108.13` and TAX. PIA, the other IMD, MEA, QTY, MOA and PRI, and the SG29, SG30 and SG38 groups are left out.                                                                                                                                                                 |
| SG25, line 2    | LIN+4 (printed page 446), numbered `2` by the loop counter and without its sub-line indicator: `LIN+2++4000862141423:EN` for `LIN+4++4000862141423:EN::+1:1`. It keeps `IMD+A++:::Rüssel von Rudi`, `QTY+47:1:PCE`, `MOA+203:108.13` and TAX. The other lines are left out.                                                                           |
| UNS, SG48, SG50 | UNS, MOA+77, MOA+79 and MOA+125 kept, then the first SG50: TAX with MOA+124. Its `MOA+79:108.13` is left out, since the SG50 of the structure has no MOA+79. The other amounts and the second SG50 are left out.                                                                                                                                      |
| Others          | DTM+200, DTM+94, DTM+263, PAI, ALI, FTX, the SG8 payment terms and the SG15 allowances are left out.                                                                                                                                                                                                                                                  |

The example's amounts do not add up, for example two lines of `108.13` and a line total of `108.13`. The golden file keeps them as the example gives them.
