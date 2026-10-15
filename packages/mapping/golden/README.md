# Golden files

The golden files hold two Messages written by hand from GS1 Germany examples: an INVOIC that an outbound Mapping Version must write, and an ORDERS that two inbound Mapping Versions must read.

## INVOIC

`invoic-reference.edi` is the INVOIC that the reference Mapping Version `invoic-reference.mapping.json` must produce from the reference Document `invoic-reference.document.json`. It is written by hand from the full example ("Gesamtbeispiel") of the [GS1 Germany CCG recommendation for EANCOM 1997 INVOIC](https://events.gs1.de/common/downloads/gs1_tech/2072_1997_invoic.pdf), update 2005, section 9, printed pages 438 to 449. It is never written from engine output.

The test reads the Document through its Document Structure, applies the Mapping Version and wraps the Message in the UNB and UNZ of the golden file. The Interchange must pass the `edifact` validator and serialize to the golden file byte for byte. The file is ISO 8859-1 (UNOC): `ü` is one Latin-1 byte.

### Document and Mapping Version

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

### Deviations from the example

The example lists more segments than the INVOIC structure of `packages/contracts` has, and several alternatives side by side. The golden file keeps 30 of its segments between UNH and UNT, in the order of the structure, with the example values unchanged except as listed:

| Segments        | Deviation                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UNB, UNZ        | Added. The example has none. Sender is the supplier GLN `4389876511113`, recipient the buyer GLN `4071615111110`, date `000320` (the message date), time `1200`, control reference `00000001`. No UNA. LF after each segment.                                                                                                                         |
| UNH, UNT        | Message reference `1` instead of `ME000001`, because the engine numbers the Message `1`. UNT `32` instead of `179`.                                                                                                                                                                                                                                   |
| BGM, CUX, TAX   | Empty trailing components and elements are left out, as the serializer writes them: `BGM+380+87441+9` for `BGM+380:::+87441+9`, `TAX+7+VAT+++:::16` for `TAX+7+VAT:::+::++:::16:::+`. CUX keeps its first currency only: `CUX+2:EUR:4` for `CUX+2:EUR:4:+3:USD:11:+`. 5305 is empty in each TAX of the example, so the Mapping Version leaves it out. |
| DTM             | DTM+137 and DTM+35 kept. The example gives `DTM+137:20000320:102` and describes it as 02.04.1998; the value is kept.                                                                                                                                                                                                                                  |
| SG1             | RFF+ON and RFF+DQ kept, each with its `DTM+171:19980301:102`. The other references are left out.                                                                                                                                                                                                                                                      |
| SG2             | NAD+BY, NAD+SU, NAD+IV and NAD+DP kept, in the order of the structure instead of BY, IV, DP, SU. Each NAD keeps only its GLN; the name and address of NAD+DP are left out. RFF+VA kept after BY and SU only, since the structure has no reference group for IV. RFF+API and the other parties are left out.                                           |
| SG6             | The header `TAX+7+VAT:::+::++:::16:::+` before CUX (printed page 441) is left out, since the structure has no header tax group.                                                                                                                                                                                                                       |
| SG25, line 1    | LIN+1 (printed page 442) with its first IMD+A, `QTY+47:11:PCE`, `MOA+203:108.13` and TAX. PIA, the other IMD, MEA, QTY, MOA and PRI, and the SG29, SG30 and SG38 groups are left out.                                                                                                                                                                 |
| SG25, line 2    | LIN+4 (printed page 446), numbered `2` by the loop counter and without its sub-line indicator: `LIN+2++4000862141423:EN` for `LIN+4++4000862141423:EN::+1:1`. It keeps `IMD+A++:::Rüssel von Rudi`, `QTY+47:1:PCE`, `MOA+203:108.13` and TAX. The other lines are left out.                                                                           |
| UNS, SG48, SG50 | UNS, MOA+77, MOA+79 and MOA+125 kept, then the first SG50: TAX with MOA+124. Its `MOA+79:108.13` is left out, since the SG50 of the structure has no MOA+79. The other amounts and the second SG50 are left out.                                                                                                                                      |
| Others          | DTM+200, DTM+94, DTM+263, PAI, ALI, FTX, the SG8 payment terms and the SG15 allowances are left out.                                                                                                                                                                                                                                                  |

The example's amounts do not add up, for example two lines of `108.13` and a line total of `108.13`. The golden file keeps them as the example gives them.

## ORDERS

`orders-reference.edi` is an ORDERS written by hand from the full example of the [GS1 Germany CCG recommendation for EANCOM 1997 ORDERS](https://events.gs1.de/common/downloads/gs1_tech/2075_1997_orders.pdf), update 2005, section 9, printed pages 164 to 168. It is never written from engine output, and neither are the two ERP Documents that the reference Mapping Versions must map it to. They are written by hand from the Message:

| Mapping Version                      | Document                         | Format                                             |
| ------------------------------------ | -------------------------------- | -------------------------------------------------- |
| `orders-reference-json.mapping.json` | `orders-reference.document.json` | JSON, UTF-8, indented by two spaces                |
| `orders-reference-csv.mapping.json`  | `orders-reference.document.csv`  | CSV, delimiter `;`, header row, Windows-1252, CRLF |

The test parses the Interchange, which must pass the `edifact` validator, and applies each Mapping Version to its Message. It reads the Document Structure from the golden Document, as an ERP sample would give it, and writes the mapped Document for that structure. The written bytes must match the golden Document byte for byte. The ORDERS file is ISO 8859-1 (UNOC), and the CSV Document is Windows-1252: `ü`, `ö` and `ä` are one byte each, in the header row (`Käufer`, `Warenempfänger`) and in the values (`Claus Früh`, `Leopardshöhle`).

### Documents and Mapping Versions

The JSON Document is one order with its line items in `lines[]`. The CSV Document has one row per line item, and repeats the header values of the order in each row:

| Message                | Transform                                                             | JSON Document                  | CSV Document                    |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------ | ------------------------------- |
| `DTM+137:20000324:102` | date format `yyyyMMdd` to `yyyy-MM-dd`; CSV `dd.MM.yyyy`              | `orderDate`: `2000-03-24`      | `Bestelldatum`: `24.03.2000`    |
| `SG25` repetitions     | loop into `lines[]` or `rows[]`, counter                              | `lines[].lineNumber`: `1`, `2` | `Position`: `1`, `2`            |
| `QTY+21:20:PCE`        | Lookup Table `PCE` to `ST`, fallback fail                             | `lines[].unit`: `ST`           | `Einheit`: `ST`                 |
| `QTY+21:20:PCE`        | none, a number field                                                  | `lines[].quantity`: `20`       | `Menge`: `20`                   |
| `PRI+AAA:10::LIU`      | JSON none, a number field; CSV number format, two decimal places, `,` | `lines[].netPrice`: `10`       | `Preis`: `10,00`                |
| `CTA+OC+Claus Früh`    | none                                                                  | `buyer.contact`: `Claus Früh`  | `Ansprechpartner`: `Claus Früh` |

The other values are plain links. The JSON Document leaves out the optional fields without a value: line 2 has no `deliveryDate` and no `netPrice`. The CSV Document writes them as empty cells. The header values in each CSV row are the order number and date, the GLNs of the buyer and the delivery party, the buyer's contact and the city of the delivery party. `Preis` is a text column, as an integration engineer sets it, since the ERP expects `10,00` and a number column would write `10`. The test adjusts the inferred structure to that.

### Deviations from the example

The example lists more segments than the ORDERS structure of `packages/contracts` has. The golden file keeps 20 of its segments between UNH and UNT, in the order of the structure, with the example values unchanged except as listed:

| Segments     | Deviation                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UNB, UNZ     | Added. The example has none. Sender is the buyer GLN `4398765000004`, recipient the supplier GLN `4012345000009`, date `000324` (the order date), time `1200`, control reference `00000001`. No UNA. LF after each segment.                                                                                                                                                        |
| UNH, UNT     | UNH kept with `ME0001`. UNT `22` instead of `66`.                                                                                                                                                                                                                                                                                                                                  |
| BGM, DTM     | `BGM+220:::+128576+9`, DTM+137 and DTM+2 kept. The example gives `DTM+137:20000324:102` and describes it as 16 October 1998; the value is kept. DTM+64, DTM+63, DTM+200 and DTM+69 are left out.                                                                                                                                                                                   |
| SG2          | NAD+BY, NAD+SU, NAD+DP and NAD+IV kept, in the order of the structure instead of SU, BY, IV, DP. NAD+DP keeps its name and address. The RFF of each party and the parties PW, SF, UC and MF are left out.                                                                                                                                                                          |
| SG5          | `CTA+OC+Claus Früh` for `CTA+PD+Claus Früh`, since the contact group of the structure has CTA+OC only. The name stays in 3413, the first component of C056, where the example puts it. `COM+kölsch@früh.de:EM` kept.                                                                                                                                                               |
| SG7          | `CUX+2:EUR:9` kept. PAT and its DTM+209 are left out.                                                                                                                                                                                                                                                                                                                              |
| SG25, line 1 | LIN+1 (printed page 166) with `PIA+1+1230815:SA::91+563985:IN::92+4000004000035:PV::9+91201:EWC::2`, `QTY+21:20:PCE`, DTM+2 and the SG28 `PRI+AAA:10::LIU`. The first C212 of PIA gives the supplier's article number. PIA+5, IMD, MEA, DTM+364, DTM+64, DTM+63, DTM+69, PRI+AAE, RFF, PAC, PCI, ALC, PCD and MOA are left out.                                                    |
| SG25, line 2 | Added, since the example has one line item and the CSV Document shows one row per line item. `LIN+2++4056786542381:EN` takes the GTIN that the example names for the promotional item under PIA+1, `PIA+1+ABC5343:SA::91` the article number of the example's PIA+5, and `QTY+21:12:PCE` the quantity of the example's control total `CNT+1:12:PCE`. It has no DTM+2 and no price. |
| UNS, CNT     | UNS kept. `CNT+2:2` for `CNT+1:1:PCE`, which the example describes as the number of line items (6069 `2`); the structure has CNT+2 only, and the Message has two lines. `CNT+1:12:PCE` is left out.                                                                                                                                                                                |
| Others       | ALI and the RFF of the order (PD, BO and AGB) are left out.                                                                                                                                                                                                                                                                                                                        |
