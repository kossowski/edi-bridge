# Fixture Documents

The fixture library holds realistic Documents, valid and deliberately broken, to submit to an inbound Channel. Use them to drive the real pipeline locally and in end-to-end tests without the Partner Simulator. Submit a fixture with a Manual Submission, or with the CLI `submit` command and the fixture's path:

```text
packages/fixtures/documents/valid/orders-nordlicht-markt.edi
```

`documents/valid/` holds the Documents that pass every stage that exists for their format. No Mapping for DESADV exists yet, so a valid dispatch CSV is only read through the Document Structure inferred from it. `documents/broken/` holds the Documents that fail at one stage, with one fault each. `src/fixtures.ts` indexes every file with its format, character encoding, Message Type and expected outcome. A broken fixture names its Failure Stage and error code. `readFixture` decodes a fixture in its encoding.

## Companies and numbers

The companies are fictional. Their GLNs, GTINs and SSCCs come from the GS1 prefixes 020 to 029, which GS1 reserves for numbers that never leave a company, and carry valid check digits. The tests check both.

| Company                | Role                              | GLN             |
| ---------------------- | --------------------------------- | --------------- |
| Hansen Feinkost GmbH   | The own company, the supplier     | `0212345000007` |
| Nordlicht Markt AG     | Trading Partner, buyer            | `0223456000008` |
| Nordlicht Markt AG     | Invoicee                          | `0223456000015` |
| Nordlicht Zentrallager | Delivery party, Hamburg           | `0223456000022` |
| Nordlicht Markt        | Delivery party, store in Lüneburg | `0223456000039` |
| Rheinwiese Handel GmbH | Trading Partner, buyer            | `0234567000009` |
| Rheinwiese Lager       | Delivery party, Köln-Porz         | `0234567000016` |
| Rheinwiese Handel GmbH | Invoicee                          | `0234567000023` |

The articles of Hansen Feinkost have the GTINs `0212345100011` to `0212345100066`.

## Formats

| Format   | Files            | Message Type | Direction of the Flow | Encoding                                      |
| -------- | ---------------- | ------------ | --------------------- | --------------------------------------------- |
| EDIFACT  | `orders-*.edi`   | ORDERS       | inbound               | ISO 8859-1 (UNOC), LF after each segment      |
| ERP JSON | `invoice-*.json` | INVOIC       | outbound              | UTF-8                                         |
| ERP CSV  | `dispatch-*.csv` | DESADV       | outbound              | Windows-1252, delimiter `;`, header row, CRLF |

Each fixture goes to an inbound Channel with a Flow for its Message Type:

- **ORDERS**: the Channel on which the Trading Partner sends, for example its SFTP Channel. The Interchange names the Message Type in each UNH, so the Channel routes it by that.
- **Invoice JSON**: the Channel on which the ERP sends, with an INVOIC Flow. The JSON has the shape of the reference invoice of `packages/mapping/golden`, so the reference Mapping Version `invoic-reference.mapping.json` maps it. That Mapping Version needs a Lookup Table that translates the unit `ST` to `PCE`.
- **Dispatch CSV**: the Channel on which the ERP sends, with a DESADV Flow. Take the Document Structure from `dispatch-nordlicht-markt.csv` as the Sample Document.

## Checks

`src/fixtures.test.ts` proves that each valid fixture passes and each broken one fails at the stage it names, with its error code:

- **ORDERS**: the `edifact` parser and validator, which the parse and validation stages run.
- **Invoice JSON**: the reference invoice Mapping Version of `packages/mapping`, then the `edifact` validator on the INVOIC it writes. An unreadable Document fails at the mapping stage, as in the pipeline.
- **Dispatch CSV**: no reference Mapping exists for DESADV, so the test only reads each Document through the Document Structure of the first valid dispatch CSV. A broken one fails at the mapping stage, where the pipeline reads the Document.

The test also checks that the index lists every file in `documents/` once, in the folder of its outcome.

## Adding a fixture

1. Put the file in `documents/valid/` or `documents/broken/`, named `<kind>-<what it shows>`, for example `orders-unknown-date-format.edi`. Write it in the encoding of its format.
2. Add it to the index in `src/fixtures.ts`. Describe what it holds and, for a broken one, its single fault.
3. Use the companies and articles above, or add numbers from the prefixes 020 to 029 with a valid check digit.
4. Run `pnpm --filter @edi-bridge/fixtures test`.

The files are kept byte for byte: Git doesn't convert their line endings, and the formatter skips them.
