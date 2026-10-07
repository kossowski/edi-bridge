# EDI Bridge

An integration platform that exchanges business documents between a company's internal systems and its trading partners, converting between in-house formats (JSON, CSV) and EDIFACT (EANCOM subset, retail supply chain).

## Language

### Parties and access

**Workspace**:
An isolated area holding one company's trading partners, mappings and traffic. Workspaces are created by the Operator only, never by self sign-up.
_Avoid_: Tenant, organization, account

**Showcase Workspace**:
A pristine, seeded Workspace that visitors browse read-only.
_Avoid_: Demo, public workspace

**Sandbox Workspace**:
A seeded Workspace where visitors may change anything; the Operator resets it to its seed on demand.
_Avoid_: Playground, test workspace

**Operator**:
The person running the platform, above all Workspaces, who creates Workspaces and their users.
_Avoid_: Superadmin, root, owner

**Admin**:
A user with full control inside one Workspace.
_Avoid_: Owner, manager

**Viewer**:
A user who can see everything inside one Workspace but change nothing.
_Avoid_: Guest, read-only user

**Trading Partner**:
An external company that exchanges business documents with the Workspace's company, e.g. a retailer ordering goods.
_Avoid_: Customer, client, partner (unqualified)

**Test Mode**:
The state of a Trading Partner during onboarding, in which every Interchange exchanged with them is flagged as a test.
_Avoid_: Staging, sandbox, dry run

**Partner Simulator**:
A stand-in for fictional Trading Partners and the company's own ERP that produces realistic traffic, including deliberately faulty documents. It is not part of EDI Bridge; to EDI Bridge it is indistinguishable from real traffic.
_Avoid_: Mock, faker, generator

### Documents

**Document**:
A single business payload received or sent on a Channel, in any format (JSON, CSV, EDIFACT).
_Avoid_: File, payload, record

**Interchange**:
One EDIFACT transmission from a sender to a receiver, enclosed in a UNB…UNZ envelope and containing one or more Messages.
_Avoid_: EDI file, batch

**Message**:
One business document inside an Interchange, enclosed in UNH…UNT, of exactly one Message Type.
_Avoid_: Transaction, EDI document

**Message Type**:
The kind of business document per the EDIFACT standard: ORDERS (purchase order), DESADV (dispatch advice), INVOIC (invoice), CONTRL and APERAK (Acknowledgements).
_Avoid_: Document type, format

**Acknowledgement**:
A Message returned by the receiver confirming syntactic receipt (CONTRL) or business acceptance/rejection (APERAK) of a previously sent Interchange or Message.
_Avoid_: Receipt, ack, confirmation

**Overdue**:
The state of a sent Interchange whose Acknowledgement has not arrived within the time limit agreed with the Trading Partner.
_Avoid_: Late, missing, timed out

**Business Reference**:
The identifier that ties Messages of different Message Types to the same business case, typically the order number.
_Avoid_: Correlation ID, reference number

**Order Lifecycle**:
The chronological chain of all Messages sharing one Business Reference, e.g. ORDERS → DESADV → INVOIC with their Acknowledgements.
_Avoid_: Order history, transaction, thread

### Processing

**Channel**:
A configured endpoint through which Documents enter or leave EDI Bridge, e.g. an SFTP folder or a webhook.
_Avoid_: Connector, endpoint, port

**Document Structure**:
The known shape of a non-EDIFACT Document (fields, nesting, repetitions), derived from a sample Document or a JSON Schema; it forms the source or target side of a Mapping.
_Avoid_: Source schema, format definition, layout

**Mapping**:
A declarative description of how a source Document is turned into a target Document, optionally using expressions for edge cases.
_Avoid_: Transformation, template, script

**Lookup Table**:
A maintained list of code translations, belonging to a Workspace or a single Trading Partner, used by Mappings, e.g. unit `ST` → `PCE`.
_Avoid_: Code list, dictionary, translation table

**Mapping Version**:
An immutable, published snapshot of a Mapping. Flows are pinned to one Mapping Version, and every Run records the version it used.
_Avoid_: Revision, release

**Draft**:
The single editable working copy of a Mapping, which becomes a new Mapping Version when published.
_Avoid_: Work in progress, unsaved mapping

**Manual Submission**:
A Document handed to EDI Bridge by a person, as if it had arrived on a chosen inbound Channel; it is processed exactly like channel traffic and marked as manual.
_Avoid_: Upload, import, manual run

**Flow**:
A rule that routes Documents of one Message Type from one Trading Partner, arriving on one Channel, through a Mapping to a destination Channel.
_Avoid_: Profile, pipeline, route

**Run**:
One execution of a Flow on one incoming Document, with its outcome, steps, errors and output.
_Avoid_: Job, transmission, execution

**Duplicate**:
An Interchange received again with the same sender and Interchange control reference as an earlier one; it is recorded but not processed.
_Avoid_: Resend, double, repeat

**Failure Stage**:
The step at which a Run failed (parse, validation, mapping or delivery), which determines whether it is fixed by Retry, by Reprocess, or only by a resend from the Trading Partner.
_Avoid_: Error type, error category

**Retry**:
Repeating the failed delivery step of a Run unchanged, for transient failures such as an unreachable destination.
_Avoid_: Resend, redo

**Reprocess**:
Starting a new Run from the original, unmodified Document of a failed Run, using a chosen Mapping version; the new Run links to the one it replaces.
_Avoid_: Rerun, replay, fix
