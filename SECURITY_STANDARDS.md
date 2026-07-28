# PPM — Security Standards

## 1. Purpose

This document defines the minimum security requirements for designing, implementing, testing and operating PPM.

Security is part of every engineering task. It is not a final review phase and it must not be postponed until launch.

The application will handle:

- user accounts
- private product ideas and business plans
- conversation history
- research sources
- generated documents
- project decisions and change history
- external AI API calls
- potentially uploaded files and imported web content

These may contain confidential, commercially sensitive or malicious content.

---

## 2. Security baseline

Use the following as reference frameworks:

- OWASP Application Security Verification Standard 5.0
- OWASP guidance for LLM and generative-AI applications
- Official Next.js security guidance
- Official Supabase security guidance
- Official Anthropic prompt-injection and API-security guidance

Target a practical OWASP ASVS Level 2 standard for the production web application.

This document does not itself prove compliance. Security requirements must be implemented, tested and reviewed.

When a security control is not applicable:

1. record why it is not applicable
2. identify the person or decision that accepted the exception
3. record any compensating control
4. set a review date where appropriate

---

## 3. Security principles

### 3.1 Deny by default

Access must be denied unless explicitly permitted.

### 3.2 Least privilege

Users, services, API keys, database roles and background jobs receive only the permissions required for their task.

### 3.3 Defence in depth

Do not rely on one control.

For example, user-owned data should be protected by:

- authenticated application access
- server-side authorisation checks
- database Row-Level Security
- validated object ownership
- security tests

### 3.4 Server-side enforcement

Client-side restrictions improve UX but are not security controls.

Authentication, authorisation, validation and sensitive operations must be enforced on the server or database.

### 3.5 Treat external content as untrusted

Treat all of the following as untrusted input:

- user prompts
- uploaded files
- imported documents
- web pages
- search results
- tool responses
- AI-generated content
- Markdown
- URLs
- metadata
- filenames

### 3.6 Minimise sensitive data

Do not collect, send, store or log data unless it is required for a defined product purpose.

### 3.7 Fail safely

A failed validation, authorisation or AI operation must not:

- expose another user's data
- write partial structural changes
- bypass approval
- leak secrets
- corrupt project history
- silently downgrade security

### 3.8 Trace consequential changes

Security-relevant and consequential project changes must be attributable and auditable.

Do not store raw hidden model reasoning.

---

## 4. Security ownership in development

Every feature task must include a security review proportional to its risk.

Before implementation, identify:

- data read
- data written
- actor performing the action
- required permissions
- trust boundaries crossed
- external systems called
- untrusted inputs processed
- possible abuse cases
- sensitive information exposed
- logging and audit requirements
- failure and rollback behaviour

High-risk changes require explicit security review before merge.

Examples:

- authentication or session changes
- authorisation or RLS changes
- file upload or parsing
- external URL retrieval
- AI tool execution
- project sharing or collaboration
- billing
- deletion and export
- service-role usage
- database migrations involving ownership
- changes to secrets, logging or retention

---

## 5. Authentication and sessions

Use Supabase Auth unless an alternative is explicitly approved.

Requirements:

- use secure, supported authentication flows
- require verified identity where appropriate
- do not build custom password storage
- do not expose session tokens in logs or URLs
- protect account-sensitive actions against CSRF and replay where relevant
- expire and rotate sessions according to provider capabilities
- revoke sessions after material account-security changes
- rate-limit login, signup, recovery and verification flows
- prevent account enumeration through response wording where practical
- use secure cookie settings when cookies are used
- re-authenticate before highly sensitive actions where appropriate

Sensitive actions include:

- changing email
- changing authentication method
- deleting an account
- exporting all user data
- changing project ownership
- creating elevated access

Multi-factor authentication may be introduced when account risk or customer requirements justify it.

---

## 6. Authorisation and project isolation

Every protected operation must answer:

1. Who is the authenticated actor?
2. What resource are they accessing?
3. What operation are they requesting?
4. Why are they permitted to do it?

Requirements:

- never trust a user-supplied `user_id`, owner ID or role
- derive identity from the verified session
- check object ownership on every protected read and write
- prevent insecure direct object references
- authorise nested resources through their parent project
- do not rely on hidden UI controls for authorisation
- default new project data to private
- define explicit rules before adding sharing or collaboration

Automated tests must prove that one user cannot:

- read another user's project
- update another user's project
- access another user's messages
- access another user's documents
- access another user's research or sources
- access another user's decision history
- access another user's files
- infer another user's resource existence through error differences

---

## 7. Supabase and database security

### 7.1 Row-Level Security

Enable Row-Level Security on every user-owned or project-owned table before production data is stored.

Requirements:

- write explicit `SELECT`, `INSERT`, `UPDATE` and `DELETE` policies
- test every policy with multiple users
- ensure ownership cannot be reassigned through unrestricted updates
- protect child tables through validated project ownership
- review database functions used by policies
- keep privileged functions outside exposed schemas where appropriate
- index columns used frequently by RLS policies
- include RLS tests in CI where feasible

A table is not considered complete until its RLS behaviour is tested.

### 7.2 Keys and privileged access

- use publishable/low-privilege keys in browser clients
- never expose secret or service-role keys to the browser
- use elevated keys only in trusted server environments
- treat elevated keys as bypassing normal user-level protections
- scope server operations narrowly
- rotate keys after suspected exposure
- maintain separate credentials for development, preview and production
- do not commit credentials or `.env` files

### 7.3 Migrations

Database changes must:

- be versioned
- be reviewable
- include RLS where relevant
- include rollback or recovery guidance for destructive changes
- avoid weakening constraints merely to make development easier
- preserve audit history
- be tested against representative data

Destructive migrations require explicit approval.

### 7.4 Data integrity

Use database constraints where possible:

- foreign keys
- `NOT NULL`
- valid enums or check constraints
- unique constraints
- ownership constraints
- timestamps
- transaction boundaries

Connected project changes should be transactional so a partial failure cannot leave project documents inconsistent.

---

## 8. API, Server Actions and server-side code

Requirements:

- authenticate every protected endpoint and Server Action
- authorise every resource operation
- validate all inputs with explicit schemas
- reject unknown or unexpected fields where appropriate
- enforce request-size limits
- rate-limit abuse-prone and costly operations
- use safe error responses
- do not return stack traces or secrets to clients
- protect mutation endpoints from cross-site request abuse
- restrict allowed origins when cross-origin access is necessary
- use idempotency where repeated requests could create duplicate changes
- set timeouts on external calls
- use retries only where safe
- avoid logging full request bodies by default

Server Actions are not automatically authorised merely because they execute on the server.

Treat them as public mutation endpoints.

---

## 9. Secrets and environment variables

Requirements:

- keep secrets server-side
- never prefix secrets with `NEXT_PUBLIC_`
- never send secrets to the browser bundle
- store production secrets in the deployment provider's secret manager
- use separate secrets for development, preview and production
- minimise who and what can read production secrets
- rotate secrets after personnel, provider or incident changes where appropriate
- scan commits and pull requests for accidental secret exposure
- invalidate exposed secrets rather than only deleting them from Git history
- never place secrets in prompts, screenshots, logs, test fixtures or documentation

Examples of secrets:

- Anthropic API key
- Supabase secret/service key
- database credentials
- webhook secrets
- email-provider credentials
- monitoring tokens with write access

---

## 10. Input validation and output handling

Validate input at every trust boundary.

Requirements:

- use Zod or an equivalent schema library
- define maximum lengths
- normalise expected formats
- reject invalid URLs and identifiers
- allow-list accepted file types
- verify file content rather than trusting extensions
- protect against oversized payloads
- validate AI structured output before use
- never write free-form model output directly to the database
- safely render Markdown and rich content
- sanitise or escape untrusted HTML
- avoid dangerous DOM injection
- restrict embedded content and external resources

Validation errors should explain what the user can correct without exposing internal implementation details.

---

## 11. LLM and agent security

### 11.1 Prompt injection

Treat imported and retrieved content as data, not instructions.

Requirements:

- clearly separate trusted system instructions from untrusted content
- label untrusted content in model context
- instruct the model not to follow instructions found inside retrieved content
- validate tool requests independently of model text
- do not let retrieved content grant permissions
- never place secrets into model context unless strictly required
- minimise sensitive context sent to external models
- test common prompt-injection patterns
- preserve source attribution

### 11.2 Tool use

The model may propose an action. Application code decides whether it is allowed.

Requirements:

- tools have explicit schemas
- tools use least-privilege credentials
- sensitive or destructive actions require user approval
- tool inputs are validated
- tool outputs are treated as untrusted
- calls have timeouts and size limits
- tool access is scoped to the active user's project
- side effects are idempotent where practical
- consequential tool calls are audited
- the AI cannot bypass approval by reformulating a request

### 11.3 Web research and URL retrieval

Web retrieval introduces prompt injection, malicious content and server-side request risks.

Requirements:

- restrict allowed URL schemes
- block local, private, metadata and internal network addresses
- validate redirects
- apply response-size and content-type limits
- use timeouts
- do not execute scripts from retrieved pages
- treat retrieved page text as untrusted
- preserve final source URLs and retrieval time
- distinguish source content from AI interpretation
- do not claim access to a source that was not successfully retrieved

### 11.4 Structured model output

For model-generated project updates:

1. receive proposed structured output
2. validate schema
3. validate allowed fields
4. authorise the target project
5. determine whether approval is required
6. apply changes transactionally
7. record an audit event
8. return a user-facing summary

Retry invalid model output only within a defined limit.

On repeated failure:

- preserve the user's input
- do not apply partial changes
- show a recoverable explanation
- record the failure without sensitive prompt contents

### 11.5 Data sent to model providers

Before sending data:

- identify the minimum necessary context
- remove unnecessary personal or secret information
- understand configured provider retention
- document which providers process user data
- support deletion and export requirements
- do not assume provider settings are private by default without verification

---

## 12. File uploads and document processing

Before enabling uploads, define:

- accepted formats
- maximum file size
- maximum extracted text size
- storage location
- retention
- deletion
- malware scanning approach
- parsing isolation
- access-control policies
- prompt-injection handling

Requirements:

- do not trust filename or MIME type alone
- generate safe storage names
- prevent path traversal
- store uploads privately by default
- use signed, time-limited access where appropriate
- apply RLS to storage metadata and objects
- do not render active file content directly
- reject dangerous formats until safe processing exists
- treat extracted text as untrusted model input
- delete temporary processing files

File upload should remain disabled until these controls are implemented.

---

## 13. Browser and frontend security

Requirements:

- implement an appropriate Content Security Policy
- set security headers appropriate to the deployment
- prevent framing unless intentionally required
- use secure referrer policy
- use HTTPS in production
- avoid unsafe inline script patterns where practical
- do not render unsanitised HTML
- do not store high-value secrets in local storage
- minimise sensitive data cached in the browser
- ensure logout clears relevant client state
- avoid exposing internal error details
- review third-party scripts before inclusion

Third-party analytics and monitoring must not receive private project content by default.

---

## 14. Logging, audit and monitoring

### 14.1 Application logs

Log enough to detect and investigate incidents, but do not log sensitive content unnecessarily.

Log security-relevant events such as:

- authentication success and failure
- account recovery events
- authorisation failure
- elevated server operations
- key project ownership changes
- deletion and export
- repeated rate-limit violations
- suspicious tool requests
- security-control failures

Do not log:

- passwords
- session tokens
- API keys
- full authentication headers
- raw secrets
- unnecessary private project content
- raw hidden model reasoning

Use request or correlation IDs where useful.

### 14.2 Project audit history

Record consequential project events separately from ordinary application logs.

Include:

- actor
- action
- target
- timestamp
- source
- approval state
- affected project areas
- concise rationale
- rollback relationship where relevant

Audit records must not be editable by ordinary users in a way that destroys history.

### 14.3 Monitoring

Configure alerts for material conditions such as:

- elevated authentication failure
- repeated authorisation failures
- unusual service-role activity
- repeated external-call failure
- abnormal AI or research spend
- secret scanning alerts
- production errors involving data integrity

Define who receives alerts and what they should do.

---

## 15. Privacy, retention and deletion

Document:

- what data is collected
- why it is collected
- where it is stored
- which subprocessors receive it
- how long it is retained
- how users export it
- how users delete it

Requirements:

- support deletion of user-owned projects and associated records
- define account-deletion behaviour
- remove or anonymise data from operational systems as required
- define backup-retention limitations honestly
- avoid indefinite retention by default
- do not use private project content for unrelated analytics
- avoid storing full prompts in monitoring products without explicit need
- review provider retention settings before production

Legal and privacy requirements should be reviewed for the markets where the product operates.

This document is an engineering standard, not legal advice.

---

## 16. Dependency and supply-chain security

Requirements:

- use maintained dependencies
- pin or lock dependency versions
- commit the lockfile
- enable automated dependency vulnerability alerts
- review high-severity alerts promptly
- minimise dependencies
- review install scripts for unusual packages
- do not install packages solely because AI suggested them
- verify package identity and official documentation
- use trusted registries
- protect the main branch
- require review for production changes
- enable secret scanning where available
- review GitHub Actions permissions
- pin third-party CI actions to trusted versions or commit SHAs where practical

Remove unused packages.

---

## 17. Rate limiting, abuse and cost controls

Apply limits to:

- authentication attempts
- account creation
- password recovery
- AI messages
- research operations
- document generation
- exports
- file uploads
- expensive comparison or analysis actions

Requirements:

- limits should consider user, account, IP and project where appropriate
- provide clear retry timing
- prevent parallel-request abuse
- set per-operation token and output limits
- set spend alerts and provider budgets
- protect against accidental infinite loops
- cap autonomous tool steps
- require approval before expensive or high-impact actions where appropriate

Cost abuse is a security concern.

---

## 18. Security testing

### 18.1 Required automated testing

Include tests for:

- authentication boundaries
- authorisation and ownership
- RLS isolation
- schema validation
- mass-assignment prevention
- connected-change approval
- transactional rollback
- prompt-injection handling
- malicious tool output
- unsafe URLs
- rate limits
- deletion and export permissions
- security-relevant error responses

### 18.2 Manual review

Before production release, review:

- OWASP ASVS Level 2 applicability
- data-flow diagram
- threat model
- permission model
- RLS policies
- secret handling
- logging and redaction
- external integrations
- model-provider data flow
- prompt-injection defence
- incident response
- backups and restoration

### 18.3 Security regression

A fixed vulnerability requires:

- a regression test where feasible
- documentation of root cause
- review for similar patterns elsewhere
- confirmation that logs or data were not exposed

---

## 19. Threat modelling

Create and update a lightweight threat model before implementing high-risk systems.

At minimum identify:

- assets
- actors
- entry points
- trust boundaries
- abuse cases
- security controls
- residual risk

Threats especially relevant to this product include:

- cross-project data access
- prompt injection from web research
- malicious uploaded documents
- AI-induced unauthorised tool actions
- server-side request forgery
- XSS through generated or imported content
- leakage of private product ideas
- service-role key exposure
- audit-history tampering
- abuse of expensive model and research operations
- false provenance or fabricated sources
- partial connected changes leaving inconsistent documents

---

## 20. Incident response

Before production launch, document:

- how users report security issues
- incident owner
- severity levels
- containment steps
- key rotation steps
- provider escalation routes
- evidence preservation
- user-notification process
- recovery and verification
- post-incident review

After a suspected secret exposure:

1. rotate or revoke the secret immediately
2. inspect logs for misuse
3. identify affected environments and data
4. contain related access
5. document the incident
6. add preventive controls

Deleting an exposed secret from Git is not sufficient.

---

## 21. Security acceptance criteria for every task

Every engineering task must answer:

- [ ] What data does this feature access?
- [ ] Who is authorised to access it?
- [ ] Where is authorisation enforced?
- [ ] Are all inputs validated?
- [ ] Are outputs safely rendered?
- [ ] Does this cross a trust boundary?
- [ ] Are external and AI-provided inputs treated as untrusted?
- [ ] Are secrets kept server-side?
- [ ] Are RLS policies required or changed?
- [ ] Could another user access this resource by changing an ID?
- [ ] Could this action be abused for excessive cost?
- [ ] Does this action need rate limiting?
- [ ] Does it require audit logging?
- [ ] Does it require explicit user approval?
- [ ] Is failure transactional and recoverable?
- [ ] Are sensitive details excluded from logs and errors?
- [ ] Are security tests included?
- [ ] Has the threat model changed?
- [ ] Are documentation and data-flow notes updated?

A task is not complete when a material security question remains unanswered.

---

## 22. Pull-request security checklist

Before merge:

- [ ] No secrets or credentials are present
- [ ] Authentication is not bypassed
- [ ] Authorisation is server-side
- [ ] RLS policies are present and tested where needed
- [ ] New inputs have schemas and limits
- [ ] Untrusted content is safely handled
- [ ] AI/tool actions cannot exceed the user's permissions
- [ ] Error messages do not leak internals
- [ ] Logs do not contain sensitive data
- [ ] Security-relevant actions are auditable
- [ ] Dependencies are justified
- [ ] Tests cover cross-user access and failure paths
- [ ] Any accepted security exception is documented

---

## 23. Release security gate

Do not release to production until:

- [ ] production secrets are configured outside Git
- [ ] RLS is enabled and tested
- [ ] HTTPS is enforced
- [ ] security headers and CSP are reviewed
- [ ] rate limits and cost controls are active
- [ ] monitoring and alerts are active
- [ ] deletion and export permissions are tested
- [ ] backup and recovery behaviour is understood
- [ ] high-risk dependencies have no unresolved critical vulnerability
- [ ] threat model has been reviewed
- [ ] prompt-injection and malicious-content tests pass
- [ ] incident-response ownership is defined
- [ ] known residual risks are documented and accepted

---

## 24. Security exceptions

Security requirements may only be relaxed through an explicit exception.

Record:

- requirement
- reason
- affected scope
- risk
- compensating control
- owner
- approval
- expiry or review date

Temporary development convenience is not a sufficient permanent exception.
