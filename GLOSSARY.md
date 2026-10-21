# EDI Bridge

An integration platform that exchanges business documents between a company's internal systems and its trading partners, converting between in-house formats (JSON, CSV) and EDIFACT (EANCOM subset, retail supply chain).

## On-screen labels

The screens show a plain label for many terms, given under _On screen_ in English and German. Labels may use words that the term lists under _Avoid_, such as "Upload" or "Example". Commits, tickets, code, contracts, and the API keep the domain terms.

## Language

### Parties and access

**Workspace**:
An isolated area holding one company's trading partners, mappings and traffic. Workspaces are created by the Operator only, never by self sign-up.
_Avoid_: Tenant, organization, account
_On screen_: Workspace (DE: Arbeitsbereich)

**Customer Workspace**:
A Workspace for one real company that exchanges real documents with its Trading Partners, unlike a Showcase or Sandbox Workspace.
_On screen_: Customer (DE: Kunde)

**Showcase Workspace**:
A pristine, seeded Workspace that visitors browse read-only.
_Avoid_: Demo, public workspace
_On screen_: Demo (DE: Demo)

**Sandbox Workspace**:
A seeded Workspace where visitors may change anything; the Operator resets it to its seed on demand.
_Avoid_: Playground, test workspace

**Operator**:
The person running the platform, above all Workspaces, who creates Workspaces and their users.
_Avoid_: Superadmin, root, owner
_On screen_: Operator (DE: Operator)

**Member**:
A user with a role, Admin or Viewer, in one Workspace. A user can be a Member of several Workspaces.
_Avoid_: Membership, team member, seat

**Invite**:
A link the Operator creates for one email address, Workspace and role, and shares by hand. Through it, the invited user sets a password and becomes a Member. It is open for 7 days, until it is used or revoked. An invite is not created for someone who is already a Member of the Workspace, and accepting one never changes the role of an existing Member.
_Avoid_: Invitation, sign-up link

**Admin**:
A user with full control inside one Workspace.
_Avoid_: Owner, manager

**Viewer**:
A user who can see everything inside one Workspace but change nothing.
_Avoid_: Guest, read-only user

**Trading Partner**:
An external company that exchanges business documents with the Workspace's company, e.g. a retailer ordering goods.
_Avoid_: Customer, client, partner (unqualified)
_On screen_: Trading partner (DE: Handelspartner)

**Test Mode**:
The state of a Trading Partner during onboarding, in which every Interchange exchanged with them is flagged as a test.
_Avoid_: Staging, sandbox, dry run
_On screen_: Testing (DE: Testbetrieb)

**Partner Simulator**:
A stand-in for fictional Trading Partners and the company's own ERP that produces realistic traffic, including deliberately faulty documents. It is not part of EDI Bridge; to EDI Bridge it is indistinguishable from real traffic.
_Avoid_: Mock, faker, generator

### Documents

**Document**:
A single business payload received or sent on a Channel, in any format (JSON, CSV, EDIFACT).
_Avoid_: File, payload, record

**Retention period**:
How long a Workspace keeps a raw Document, set per Workspace by the Operator between 7 and 730 days, 90 by default. Once it ends, the Document expires and is deleted while its Runs stay; a Run whose Document expired cannot be Reprocessed, and Duplicates are only recognised within the retention period.
_Avoid_: Retention time, storage period, TTL
_On screen_: Keep documents for (DE: Belege aufbewahren)

**Interchange**:
One EDIFACT transmission from a sender to a receiver, enclosed in a UNB…UNZ envelope and containing one or more Messages.
_Avoid_: EDI file, batch
_On screen_: Transmission (DE: Übertragung)

**Message**:
One business document inside an Interchange, enclosed in UNH…UNT, of exactly one Message Type.
_Avoid_: Transaction, EDI document

**Message Type**:
The kind of business document per the EDIFACT standard: ORDERS (purchase order), DESADV (dispatch advice), INVOIC (invoice), CONTRL and APERAK (Acknowledgements).
_Avoid_: Document type, format
_On screen_: Document type (DE: Belegart), ORDERS → Purchase order (DE: Bestellung), DESADV → Dispatch advice (DE: Lieferavis), INVOIC → Invoice (DE: Rechnung), CONTRL → Receipt confirmation (DE: Empfangsbestätigung)

**Code List**:
The set of codes the EDIFACT directory allows for one coded data element, e.g. `220` (order) for the document name code. Validation rejects any other code. Unlike a Lookup Table, it is part of the standard and translates nothing.
_Avoid_: Code table, enumeration, Lookup Table

**Acknowledgement**:
A Message returned by the receiver confirming syntactic receipt (CONTRL) or business acceptance/rejection (APERAK) of a previously sent Interchange or Message.
_Avoid_: Receipt, ack, confirmation
_On screen_: Receipt confirmation (DE: Empfangsbestätigung)

**Overdue**:
The state of a sent Interchange whose Acknowledgement has not arrived within the time limit agreed with the Trading Partner.
_Avoid_: Late, missing, timed out
_On screen_: Overdue (DE: Überfällig)

**Business Reference**:
The identifier that ties Messages of different Message Types to the same business case, typically the order number.
_Avoid_: Correlation ID, reference number
_On screen_: Order number (DE: Bestellnummer)

**Order Lifecycle**:
The chronological chain of all Messages sharing one Business Reference, e.g. ORDERS → DESADV → INVOIC with their Acknowledgements.
_Avoid_: Order history, transaction, thread
_On screen_: Order (DE: Auftrag)

**Order Lifecycle Status**:
The overall state of an Order Lifecycle, derived from the current Run and Acknowledgement of each Message Type. It has one of four values.
On track: nothing needs action, and at least one Message Type is still open or in progress.
Needs attention: a Run failed and does not wait for the Trading Partner, an Acknowledgement was rejected or is Overdue, or the CONTRL to a received Interchange was not sent.
Waiting for the Trading Partner: a failed Run waits for a resend from the Trading Partner, or an Acknowledgement is pending within the time limit.
Done: every Message Type was delivered, and every sent Interchange was accepted. An Interchange sent before Acknowledgements were tracked has no Acknowledgement and counts as accepted.
_Avoid_: Order status, phase, partner status
_On screen_: on track → On track (DE: Im Plan), needs attention → Needs attention (DE: Handlungsbedarf), waiting for the Trading Partner → Waiting for partner (DE: Wartet auf Partner), done → Done (DE: Erledigt)

### Processing

**Channel**:
A configured endpoint through which Documents enter or leave EDI Bridge, e.g. an SFTP folder or a webhook.
_Avoid_: Connector, endpoint, port
_On screen_: Connection (DE: Verbindung)

**Poll problem**:
Why an inbound SFTP Channel could not be polled, stored with the time of the first failure and cleared by the next successful poll; not a Defect.
_Avoid_: Poll error, connection error
_On screen_: Polling failed (DE: Abfrage fehlgeschlagen)

**Document Structure**:
The known shape of a non-EDIFACT Document (fields, nesting, repetitions), derived from a sample Document or a JSON Schema; it forms the source or target side of a Mapping.
_Avoid_: Source schema, format definition, layout
_On screen_: Data format, listed as "Your data formats" (DE: Datenformat, listed as "Ihre Datenformate")

**Mapping**:
A declarative description of how a source Document is turned into a target Document, optionally using expressions for edge cases.
_Avoid_: Transformation, template, script
_On screen_: Mapping (DE: Mapping)

**Transform**:
A step from a fixed catalogue, placed in a Mapping between source and target, that converts values on their way, e.g. a date format or a Lookup Table translation.
_Avoid_: Transformation, function, operator

**Transform Link**:
A link in a Mapping that starts or ends at a Transform, unlike a plain link from a source field straight to a target element.
_Avoid_: Edge, wire, connection

**Lookup Table**:
A maintained list of code translations, belonging to a Workspace or a single Trading Partner, used by Mappings, e.g. unit `ST` → `PCE`.
_Avoid_: Dictionary, translation table
_On screen_: Code translation (DE: Code-Übersetzung)

**Mapping Version**:
An immutable, published snapshot of a Mapping. Flows are pinned to one Mapping Version, and every Run records the version it used.
_Avoid_: Revision, release
_On screen_: Version (DE: Version)

**Draft**:
The single editable working copy of a Mapping, which becomes a new Mapping Version when published.
_Avoid_: Work in progress, unsaved mapping
_On screen_: Draft (DE: Entwurf)

**Sample Document**:
A representative source Document stored with a Mapping, on which the Draft's preview shows the target Document it would produce.
_Avoid_: Example, test file, fixture
_On screen_: Example document (DE: Beispielbeleg)

**Manual Submission**:
A Document handed to EDI Bridge by a person, as if it had arrived on a chosen inbound Channel; it is processed exactly like channel traffic and marked as manual.
_Avoid_: Upload, import, manual run
_On screen_: Upload (DE: Upload)

**Flow**:
A rule that routes Documents of one Message Type from one Trading Partner, arriving on one Channel, through a Mapping to a destination Channel.
_Avoid_: Profile, pipeline, route
_On screen_: Document route (DE: Belegweg)

**Run**:
One execution of a Flow on one incoming Document, with its outcome, steps, errors and output.
_Avoid_: Job, transmission, execution
_On screen_: Document (DE: Beleg)

**Duplicate**:
A Document received again: an Interchange with the same sender and Interchange control reference as an earlier one in the Workspace, or a file polled from an SFTP Channel with the same Channel, file name and hash of its bytes as an earlier one. Only an earlier Document within the Workspace's retention period counts, since an expired Document takes its keys with it.
_Avoid_: Resend, double, repeat
_On screen_: Duplicate (DE: Duplikat)

**Failure Stage**:
The step at which a Run failed (parse, validation, mapping or delivery), which determines whether it is fixed by Retry, by Reprocess, or only by a resend from the Trading Partner; a Defect is the exception, fixed by trying again at any Failure Stage.
_Avoid_: Error type, error category

**Defect**:
An unexpected error in EDI Bridge itself, not in the Document or the setup, that fails a Run or stops background work such as polling a Channel or the sweep. A failed Run is fixed by trying again (Retry at delivery, Reprocess with the Run's own Mapping Version at any other Failure Stage). Every Defect is reported to error monitoring; one that repeats in the same background work, such as during a database outage, is reported once until that work succeeds again.
_Avoid_: Bug, crash

**Retry**:
Repeating the failed delivery step of a Run unchanged, for transient failures such as an unreachable destination.
_Avoid_: Resend, redo
_On screen_: Try again (DE: Erneut versuchen)

**Reprocess**:
Starting a new Run from the original, unmodified Document of a failed Run, using a chosen Mapping version; the new Run links to the one it replaces.
_Avoid_: Rerun, replay, fix
_On screen_: Process again (DE: Erneut verarbeiten)

**Live event**:
A notice to the Members of a Workspace that one of its Runs was created or changed, so the screens they have open show the change without a reload.
_Avoid_: Notification, push, update
